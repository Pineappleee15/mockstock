import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sql as pg, competitions, teams, portfolios, holdings, stocks, leaderboardCurrent } from "../src/db";
import { openMarket, setMarketState } from "../src/lib/market";
import { runOneTick } from "../src/lib/ticker";
import { placeOrder } from "../src/lib/orders";
import { seedFromString } from "../src/lib/rng";

const admin = { kind: "admin" as const, id: 1, label: "admin" };
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

async function count(table: string, where: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`));
  return Number((r as unknown as Array<{ n: number }>)[0]!.n);
}

async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const allTeams = await db.query.teams.findMany({ where: eq(teams.competitionId, comp.id) });
  const victim = allTeams[0]!;

  console.log("\n=== deleting a team removes everything belonging to it ===");
  await openMarket(admin, comp.id);
  await runOneTick(comp.id);
  const buy = await placeOrder({
    teamId: victim.id, symbol: "TCS", side: "buy", quantity: 5, idempotencyKey: randomUUID() });
  check("victim team has a trade", buy.ok, buy.ok ? "" : buy.code);
  await runOneTick(comp.id);
  await runOneTick(comp.id);

  const before = {
    portfolios: await count("portfolios", `team_id = ${victim.id}`),
    trades: await count("trades", `team_id = ${victim.id}`),
    orders: await count("orders", `team_id = ${victim.id}`),
    leaderboard: await count("leaderboard_current", `team_id = ${victim.id}`),
  };
  check("has portfolio, trades, orders and a leaderboard row",
    before.portfolios === 1 && before.trades > 0 && before.orders > 0 && before.leaderboard === 1,
    JSON.stringify(before));

  // A holdings row hangs off the portfolio, not the team — check that cascades too.
  const pf = (await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, victim.id) }))!;
  const heldBefore = await count("holdings", `portfolio_id = ${pf.id}`);
  check("has a holdings row", heldBefore > 0, `n=${heldBefore}`);

  await db.delete(teams).where(eq(teams.id, victim.id));

  const after = {
    teams: await count("teams", `id = ${victim.id}`),
    portfolios: await count("portfolios", `team_id = ${victim.id}`),
    trades: await count("trades", `team_id = ${victim.id}`),
    orders: await count("orders", `team_id = ${victim.id}`),
    leaderboard: await count("leaderboard_current", `team_id = ${victim.id}`),
    holdings: await count("holdings", `portfolio_id = ${pf.id}`),
  };
  check("every trace of the team is gone",
    Object.values(after).every((n) => n === 0), JSON.stringify(after));

  const survivors = await db.query.teams.findMany({ where: eq(teams.competitionId, comp.id) });
  check("other teams untouched", survivors.length === allTeams.length - 1,
    `${survivors.length} of ${allTeams.length - 1}`);

  console.log("\n=== leaderboard recovers after a delete ===");
  await runOneTick(comp.id);
  await runOneTick(comp.id);
  const lb = await db.select().from(leaderboardCurrent)
    .where(eq(leaderboardCurrent.competitionId, comp.id));
  check("leaderboard has no orphan row", lb.length === survivors.length,
    `rows=${lb.length} teams=${survivors.length}`);
  check("ranks still start at 1", Math.min(...lb.map((r) => r.rank)) === 1);

  console.log("\n=== creating a new competition ===");
  // Refused while the current one is live.
  const liveNow = await db.query.competitions.findFirst({
    where: sql`state IN ('pre_open','open','paused')`,
  });
  check("current competition is detected as live", !!liveNow, liveNow?.state ?? "none");

  await setMarketState(admin, comp.id, "ended");
  const stillLive = await db.query.competitions.findFirst({
    where: sql`state IN ('pre_open','open','paused')`,
  });
  check("ending it frees the slot", !stillLive);

  const source = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  const [created] = await db.insert(competitions).values({
    name: "Second Event", mode: "event", state: "draft",
    startingCashPaise: 50_000_000,
  }).returning();

  await db.insert(stocks).values(source.map((s) => ({
    competitionId: created!.id,
    symbol: s.symbol, name: s.name, sector: s.sector,
    startingPricePaise: s.startingPricePaise,
    volatilityBps: s.volatilityBps, driftBps: s.driftBps,
    liquidity: s.liquidity, circuitLimitBps: s.circuitLimitBps,
    seed: seedFromString(`${created!.id}:${s.symbol}`) % 2_000_000_000,
  })));

  const copied = await db.query.stocks.findMany({ where: eq(stocks.competitionId, created!.id) });
  check("stock universe copied across", copied.length === source.length,
    `${copied.length} of ${source.length}`);
  check("new competition starts with no teams",
    (await count("teams", `competition_id = ${created!.id}`)) === 0);
  check("old competition keeps its data",
    (await count("teams", `competition_id = ${comp.id}`)) === survivors.length);

  // Seeds must differ, or both events would produce identical price paths.
  const oldTcs = source.find((s) => s.symbol === "TCS")!;
  const newTcs = copied.find((s) => s.symbol === "TCS")!;
  check("copied stocks get fresh price seeds", oldTcs.seed !== newTcs.seed,
    `${oldTcs.seed} vs ${newTcs.seed}`);

  console.log("\n=== the one-live-competition rule still holds ===");
  await openMarket(admin, created!.id);
  let refused = false;
  try {
    await db.update(competitions).set({ state: "open" }).where(eq(competitions.id, comp.id));
  } catch { refused = true; }
  check("database refuses a second live competition", refused);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
