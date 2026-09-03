import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, teams, portfolios, holdings, trades } from "../src/db";
import { openMarket } from "../src/lib/market";
import { runOneTick } from "../src/lib/ticker";
import { placeOrder } from "../src/lib/orders";
import { formatRupees } from "../src/lib/money";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const allTeams = await db.query.teams.findMany({ where: eq(teams.competitionId, comp.id) });
  const t = allTeams[0]!;

  await openMarket({ kind: "admin", id: 1, label: "test" }, comp.id);
  await runOneTick(comp.id);

  console.log("\n=== off by default ===");
  const blocked = await placeOrder({
    teamId: t.id, symbol: "ITC", side: "sell", quantity: 50, idempotencyKey: randomUUID() });
  check("cannot sell what you do not hold", !blocked.ok && blocked.code === "SHORTING_DISABLED",
    blocked.ok ? "filled" : blocked.code);

  await db.update(competitions).set({ shortSellingEnabled: true }).where(eq(competitions.id, comp.id));

  console.log("\n=== opening a short ===");
  const open1 = await placeOrder({
    teamId: t.id, symbol: "ITC", side: "sell", quantity: 200, idempotencyKey: randomUUID() });
  check("short opens", open1.ok, open1.ok ? formatRupees(open1.fillPricePaise) : open1.code);

  const pf = (await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, t.id) }))!;
  const stk = (await db.query.stocks.findFirst({
    where: and(eq(stocks.competitionId, comp.id), eq(stocks.symbol, "ITC")) }))!;
  const h = (await db.query.holdings.findFirst({
    where: and(eq(holdings.portfolioId, pf.id), eq(holdings.stockId, stk.id)) }))!;
  check("holding is negative", h.quantity === -200, String(h.quantity));
  check("average sale price recorded", h.avgCostPaise > 0, formatRupees(h.avgCostPaise));
  check("proceeds credited", pf.cashPaise > comp.startingCashPaise, formatRupees(pf.cashPaise));

  console.log("\n=== a short leaves no mark on the price ===");
  const flow = await db.execute(sql`
    SELECT COALESCE(SUM(flow_qty), 0)::int AS f FROM trades WHERE team_id = ${t.id}`);
  check("short contributes zero order flow",
    Number((flow as unknown as Array<{ f: number }>)[0]!.f) === 0,
    String((flow as unknown as Array<{ f: number }>)[0]!.f));

  console.log("\n=== covering ===");
  await runOneTick(comp.id);
  const cover = await placeOrder({
    teamId: t.id, symbol: "ITC", side: "buy", quantity: 120, idempotencyKey: randomUUID() });
  check("partial cover fills", cover.ok, cover.ok ? `realised ${formatRupees(cover.realisedPnlPaise, { sign: true })}` : cover.code);

  const h2 = (await db.query.holdings.findFirst({
    where: and(eq(holdings.portfolioId, pf.id), eq(holdings.stockId, stk.id)) }))!;
  check("still short the remainder", h2.quantity === -80, String(h2.quantity));
  check("average sale price unchanged by a partial cover",
    h2.avgCostPaise === h.avgCostPaise, `${h2.avgCostPaise} vs ${h.avgCostPaise}`);

  console.log("\n=== flipping short to long ===");
  const flip = await placeOrder({
    teamId: t.id, symbol: "ITC", side: "buy", quantity: 200, idempotencyKey: randomUUID() });
  check("flip fills", flip.ok, flip.ok ? "" : flip.code);
  const h3 = (await db.query.holdings.findFirst({
    where: and(eq(holdings.portfolioId, pf.id), eq(holdings.stockId, stk.id)) }))!;
  check("now long the difference", h3.quantity === 120, String(h3.quantity));
  check("average cost is the buy price, not the old short price",
    h3.avgCostPaise !== h.avgCostPaise, formatRupees(h3.avgCostPaise));

  console.log("\n=== the books still balance ===");
  const drift = await db.execute(sql`
    SELECT (p.cash_paise
      + COALESCE((SELECT SUM(h.quantity::bigint * h.avg_cost_paise + h.cost_residual)
                  FROM holdings h WHERE h.portfolio_id = p.id), 0)
      + p.brokerage_paid_paise - p.realised_pnl_paise - ${comp.startingCashPaise}) AS diff
    FROM portfolios p WHERE p.team_id = ${t.id}`);
  const d = Number((drift as unknown as Array<{ diff: string }>)[0]!.diff);
  check("cash + cost basis + fees reconciles through a short round trip",
    d === 0, `drift ${formatRupees(d)}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
