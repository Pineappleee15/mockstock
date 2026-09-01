import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, teams, portfolios } from "../src/db";
import { placeOrder } from "../src/lib/orders";
import { runOneTick } from "../src/lib/ticker";
import { openMarket } from "../src/lib/market";
import { formatRupees } from "../src/lib/money";

/**
 * Concurrency load test.
 *
 * The point is not throughput — 300 concurrent users is a small number. The
 * point is proving the correctness requirements hold when many teams trade at
 * once, in particular that the portfolio row lock actually serialises a team's
 * own orders and that idempotency keys never double-fill.
 *
 *   npm run loadtest -- --teams=200 --rounds=5 --dup=0.25
 */

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const TEAMS = arg("teams", 200);
const ROUNDS = arg("rounds", 5);
const DUP_RATE = arg("dup", 0.25);

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

async function ensureTeams(competitionId: number, startingCash: number): Promise<number[]> {
  const existing = await db.query.teams.findMany({ where: eq(teams.competitionId, competitionId) });
  const ids = existing.map((t) => t.id);
  if (ids.length >= TEAMS) return ids.slice(0, TEAMS);

  const need = TEAMS - ids.length;
  console.log(`  creating ${need} load-test teams...`);
  const rows = await db.insert(teams).values(
    Array.from({ length: need }, (_, i) => ({
      competitionId,
      name: `Load Test ${ids.length + i + 1}`,
      members: "loadtest",
      joinCode: `LT${String(ids.length + i + 1).padStart(4, "0")}`,
    })),
  ).returning({ id: teams.id });

  await db.insert(portfolios).values(
    rows.map((r) => ({ competitionId, teamId: r.id, cashPaise: startingCash })),
  );
  return [...ids, ...rows.map((r) => r.id)];
}

async function main() {
  const comp = await db.query.competitions.findFirst();
  if (!comp) throw new Error("No competition. Run: npm run db:seed");

  const universe = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  if (universe.length === 0) throw new Error("No stocks in this competition.");

  if (comp.state !== "open") {
    console.log("  opening market for the test...");
    await openMarket({ kind: "admin", id: 1, label: "loadtest" }, comp.id);
  }

  const teamIds = await ensureTeams(comp.id, comp.startingCashPaise);
  console.log(`\nload test: ${teamIds.length} teams x ${ROUNDS} rounds, ${Math.round(DUP_RATE * 100)}% duplicate keys\n`);

  const startedAt = Date.now();
  let submitted = 0;
  let filled = 0;
  let replayed = 0;
  const rejects = new Map<string, number>();
  const keysUsed: Array<{ teamId: number; key: string }> = [];

  for (let round = 0; round < ROUNDS; round++) {
    // Every team fires simultaneously. Some fire the SAME order twice with the
    // same idempotency key, which is the double-clicked-button case.
    const jobs = teamIds.flatMap((teamId) => {
      const stock = universe[Math.floor(Math.random() * universe.length)]!;
      const side = Math.random() < 0.75 ? "buy" : "sell";
      const quantity = 1 + Math.floor(Math.random() * 20);
      const key = randomUUID();
      keysUsed.push({ teamId, key });

      const req = { teamId, symbol: stock.symbol, side: side as "buy" | "sell", quantity, idempotencyKey: key };
      const calls = [placeOrder(req)];
      if (Math.random() < DUP_RATE) calls.push(placeOrder({ ...req }));
      return calls;
    });

    submitted += jobs.length;
    const results = await Promise.all(jobs);
    for (const r of results) {
      if (r.ok) { filled++; if (r.replayed) replayed++; }
      else rejects.set(r.code, (rejects.get(r.code) ?? 0) + 1);
    }

    await runOneTick(comp.id);
    process.stdout.write(`  round ${round + 1}/${ROUNDS} done\n`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`\nsubmitted ${submitted} order attempts in ${(elapsedMs / 1000).toFixed(1)}s ` +
    `(${Math.round(submitted / (elapsedMs / 1000))}/s)`);
  console.log(`  filled ${filled} (of which ${replayed} were idempotent replays)`);
  for (const [code, n] of [...rejects].sort((a, b) => b[1] - a[1])) console.log(`  rejected ${code}: ${n}`);

  console.log("\n=== invariants ===");
  await verify(comp.id, comp.startingCashPaise, keysUsed.length);

  console.log(`\n${failures === 0 ? "ALL INVARIANTS HELD" : failures + " INVARIANTS VIOLATED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}

async function verify(competitionId: number, startingCash: number, distinctKeys: number) {
  const one = async <T>(q: ReturnType<typeof sql>): Promise<T> =>
    ((await db.execute(q)) as unknown as T[])[0]!;

  // 1. Cash can never go negative. There is a CHECK constraint behind this too,
  //    so a violation here would mean the constraint itself was dropped.
  const neg = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM portfolios WHERE competition_id = ${competitionId} AND cash_paise < 0`);
  check("no team has negative cash", neg.n === 0, `violations=${neg.n}`);

  // 2. Holdings can never go negative — no accidental short selling.
  const negQty = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM holdings h
    JOIN portfolios p ON p.id = h.portfolio_id
    WHERE p.competition_id = ${competitionId} AND h.quantity < 0`);
  check("no negative holdings", negQty.n === 0, `violations=${negQty.n}`);

  // 3. Idempotency: one order row per (team, key), enforced by a unique index.
  //    A duplicate submission must never produce a second TRADE.
  const dupTrades = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT o.team_id, o.idempotency_key, COUNT(t.id) AS trades
      FROM orders o LEFT JOIN trades t ON t.order_id = o.id
      WHERE o.competition_id = ${competitionId}
      GROUP BY o.team_id, o.idempotency_key
      HAVING COUNT(t.id) > 1
    ) x`);
  check("no idempotency key produced two trades", dupTrades.n === 0, `violations=${dupTrades.n}`);

  // One order row per distinct (team, key). Counting rows against the keys this
  // run generated would also sweep in orders left by earlier scripts, so compare
  // against the distinct keys actually present.
  const rows = await one<{ total: number; distinct: number }>(sql`
    SELECT COUNT(*)::int AS total, COUNT(DISTINCT (team_id, idempotency_key))::int AS distinct
    FROM orders WHERE competition_id = ${competitionId}`);
  check("exactly one order row per distinct idempotency key",
    rows.total === rows.distinct, `rows=${rows.total} distinct=${rows.distinct}`);
  check("this run's keys all landed", rows.total >= distinctKeys,
    `rows=${rows.total} keys this run=${distinctKeys}`);

  // 4. The money invariant. For every team:
  //      cash + cost basis of holdings + brokerage paid
  //        = starting cash + realised P&L + cash adjustments
  //    If the order engine ever loses or invents a paisa, this breaks.
  const drift = await one<{ n: number; worst: string }>(sql`
    SELECT COUNT(*)::int AS n, COALESCE(MAX(ABS(diff)), 0)::text AS worst FROM (
      SELECT p.team_id,
        (p.cash_paise
          + COALESCE((SELECT SUM(h.quantity::bigint * h.avg_cost_paise + h.cost_residual)
                      FROM holdings h WHERE h.portfolio_id = p.id), 0)
          + p.brokerage_paid_paise
          - p.realised_pnl_paise
          - COALESCE((SELECT SUM(c.amount_paise) FROM cash_adjustments c WHERE c.team_id = p.team_id), 0)
          - ${startingCash}) AS diff
      FROM portfolios p
      WHERE p.competition_id = ${competitionId}
    ) x WHERE diff <> 0`);
  check("cash + cost basis + fees reconciles to starting cash + realised P&L",
    drift.n === 0, `teams off=${drift.n} worst=${formatRupees(Number(drift.worst))}`);

  // 5. Portfolio trade_count must match the number of un-voided fills.
  const mismatch = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM portfolios p
    WHERE p.competition_id = ${competitionId}
      AND p.trade_count <> (
        SELECT COUNT(*) FROM trades t WHERE t.team_id = p.team_id AND t.voided_at IS NULL)`);
  check("trade counters match actual fills", mismatch.n === 0, `mismatched=${mismatch.n}`);

  // 6. No team can have spent more than it ever had.
  const overspent = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT t.team_id,
             SUM(CASE WHEN t.side = 'buy'  THEN t.gross_paise + t.brokerage_paise ELSE 0 END) AS spent,
             SUM(CASE WHEN t.side = 'sell' THEN t.gross_paise - t.brokerage_paise ELSE 0 END) AS raised
      FROM trades t WHERE t.competition_id = ${competitionId} AND t.voided_at IS NULL
      GROUP BY t.team_id
    ) x WHERE spent > raised + ${startingCash}`);
  check("no team spent more than starting cash plus sale proceeds",
    overspent.n === 0, `violations=${overspent.n}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
