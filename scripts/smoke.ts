import "dotenv/config";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sql as pg, competitions, stocks, teams, portfolios, priceTicks, leaderboardCurrent } from "../src/db";
import { openMarket, publishNews, setMarketState, voidTrade } from "../src/lib/market";
import { runOneTick } from "../src/lib/ticker";
import { placeOrder } from "../src/lib/orders";
import { formatRupees } from "../src/lib/money";

const admin = { kind: "admin" as const, id: 1, label: "admin" };
let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const allTeams = await db.query.teams.findMany({ where: eq(teams.competitionId, comp.id) });
  const allStocks = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  const tcs = allStocks.find((s) => s.symbol === "TCS")!;

  console.log("\n=== 1. open market ===");
  await openMarket(admin, comp.id);
  const t0 = await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, tcs.id), eq(priceTicks.tickIndex, 0)),
  });
  check("tick 0 published", !!t0, t0 ? formatRupees(t0.pricePaise) : "");
  const tcsRow = await db.query.stocks.findFirst({ where: eq(stocks.id, tcs.id) });
  check("session open captured", !!tcsRow!.sessionOpenPaise);

  console.log("\n=== 2. price engine advances ===");
  for (let i = 0; i < 10; i++) await runOneTick(comp.id);
  const after = (await db.query.competitions.findFirst({ where: eq(competitions.id, comp.id) }))!;
  // >= rather than ==: if the dev server is running it has its own ticker on the
  // same competition, which legitimately advances the clock alongside this script.
  check("tick advanced by at least 10", after.currentTick >= 10, `tick=${after.currentTick}`);
  const ticks = await db.select().from(priceTicks).where(eq(priceTicks.stockId, tcs.id));
  check("a tick row exists for every tick", ticks.length === after.currentTick + 1,
    `rows=${ticks.length} tick=${after.currentTick}`);
  const prices = ticks.sort((a, b) => a.tickIndex - b.tickIndex).map((t) => t.pricePaise);
  check("prices actually moved", new Set(prices).size > 1);
  check("all prices positive integers", prices.every((p) => Number.isInteger(p) && p > 0));
  console.log("    TCS path:", prices.map((p) => (p / 100).toFixed(2)).join(" -> "));

  console.log("\n=== 3. orders ===");
  const team = allTeams[0]!;
  const buy = await placeOrder({
    teamId: team.id, symbol: "TCS", side: "buy", quantity: 10, idempotencyKey: randomUUID(),
  });
  check("buy filled", buy.ok, buy.ok ? `${formatRupees(buy.fillPricePaise)} x10` : buy.code);
  const pf = await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, team.id) });
  check("cash decreased", pf!.cashPaise < comp.startingCashPaise, formatRupees(pf!.cashPaise));

  console.log("\n=== 4. idempotency ===");
  const key = randomUUID();
  const a = await placeOrder({ teamId: team.id, symbol: "INFY", side: "buy", quantity: 5, idempotencyKey: key });
  const b = await placeOrder({ teamId: team.id, symbol: "INFY", side: "buy", quantity: 5, idempotencyKey: key });
  check("first order filled", a.ok);
  check("duplicate replayed, not refilled", b.ok && b.replayed === true);
  check("same order id returned", a.ok && b.ok && a.orderId === b.orderId);

  console.log("\n=== 5. concurrent double-spend (the race condition) ===");
  // The concentration cap means one order can never exceed 40% of the portfolio,
  // so TWO concurrent orders cannot overdraw cash. Six can: 6 x ~30% = 180%.
  // Each is in a different stock, so the cap passes and only cash can stop them.
  const rich = allTeams[1]!;
  const pfRich = (await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, rich.id) }))!;
  const priceNow = (await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, tcs.id), eq(priceTicks.tickIndex, after.currentTick)),
  }))!.pricePaise;

  const raceSymbols = ["TCS", "INFY", "WIPRO", "HCLTECH", "SBIN", "ITC"];
  const raceOrders = await Promise.all(raceSymbols.map(async (sym) => {
    const st = allStocks.find((s) => s.symbol === sym)!;
    const p = (await db.query.priceTicks.findFirst({
      where: and(eq(priceTicks.stockId, st.id), eq(priceTicks.tickIndex, after.currentTick)),
    }))!.pricePaise;
    return { sym, qty: Math.max(1, Math.floor((pfRich.cashPaise * 0.3) / p)) };
  }));
  const results = await Promise.all(raceOrders.map((o) =>
    placeOrder({ teamId: rich.id, symbol: o.sym, side: "buy", quantity: o.qty, idempotencyKey: randomUUID() })));
  const filled = results.filter((r) => r.ok).length;
  check("not all six 30% orders filled", filled < 6, `filled=${filled}`);
  check("every rejection has a reason", results.every((r) => r.ok || !!r.code),
    `results=${results.map((r) => (r.ok ? "filled" : r.code)).join(",")}`);
  const pfAfter = (await db.query.portfolios.findFirst({ where: eq(portfolios.teamId, rich.id) }))!;
  check("cash never went negative", pfAfter.cashPaise >= 0, formatRupees(pfAfter.cashPaise));
  const spent = await db.execute(sql`
    SELECT COALESCE(SUM(gross_paise + brokerage_paise), 0)::bigint AS total
    FROM trades WHERE team_id = ${rich.id} AND side = 'buy' AND voided_at IS NULL`);
  const totalSpent = Number((spent as unknown as Array<{ total: string }>)[0]!.total);
  check("total spend never exceeded starting cash", totalSpent <= comp.startingCashPaise,
    `spent=${formatRupees(totalSpent)} of ${formatRupees(comp.startingCashPaise)}`);

  console.log("\n=== 6. concentration cap ===");
  const capTeam = allTeams[2]!;
  const capQty = Math.floor((comp.startingCashPaise * 0.6) / priceNow);
  const capRes = await placeOrder({
    teamId: capTeam.id, symbol: "TCS", side: "buy", quantity: capQty, idempotencyKey: randomUUID(),
  });
  check("60% of portfolio in one stock rejected", !capRes.ok && capRes.code === "CONCENTRATION_CAP",
    capRes.ok ? "filled" : capRes.code);

  console.log("\n=== 7. sell and realised P&L ===");
  const sell = await placeOrder({
    teamId: team.id, symbol: "TCS", side: "sell", quantity: 5, idempotencyKey: randomUUID(),
  });
  check("sell filled", sell.ok, sell.ok ? `realised ${formatRupees(sell.realisedPnlPaise, { sign: true })}` : sell.code);
  const oversell = await placeOrder({
    teamId: team.id, symbol: "TCS", side: "sell", quantity: 9999, idempotencyKey: randomUUID(),
  });
  check("overselling rejected", !oversell.ok && oversell.code === "INSUFFICIENT_HOLDINGS");

  console.log("\n=== 8. order flow moves price ===");
  const before = (await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, tcs.id), eq(priceTicks.tickIndex, after.currentTick)),
  }))!;
  await runOneTick(comp.id);
  const comp2 = (await db.query.competitions.findFirst({ where: eq(competitions.id, comp.id) }))!;
  const afterFlow = (await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, tcs.id), eq(priceTicks.tickIndex, comp2.currentTick)),
  }))!;
  check("net buying recorded on the tick", afterFlow.netQty > 0, `netQty=${afterFlow.netQty}`);
  check("gap opened above anchor", afterFlow.gapBps > 0, `gap=${afterFlow.gapBps}bps`);
  console.log(`    ${formatRupees(before.pricePaise)} -> ${formatRupees(afterFlow.pricePaise)}`);

  console.log("\n=== 9. news event ===");
  await publishNews(admin, comp.id, {
    headline: "RBI holds repo rate, signals softer stance",
    impactBps: 400, decaySeconds: 30,
    stockIds: allStocks.filter((s) => s.sector === "Banking").map((s) => s.id),
  });
  const hdfc = allStocks.find((s) => s.symbol === "HDFCBANK")!;
  const pre = (await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, hdfc.id), eq(priceTicks.tickIndex, comp2.currentTick)),
  }))!;
  for (let i = 0; i < 6; i++) await runOneTick(comp.id);
  const comp3 = (await db.query.competitions.findFirst({ where: eq(competitions.id, comp.id) }))!;
  const post = (await db.query.priceTicks.findFirst({
    where: and(eq(priceTicks.stockId, hdfc.id), eq(priceTicks.tickIndex, comp3.currentTick)),
  }))!;
  check("news moved the banking stock up", post.pricePaise > pre.pricePaise,
    `${formatRupees(pre.pricePaise)} -> ${formatRupees(post.pricePaise)}`);

  console.log("\n=== 10. leaderboard ===");
  const lb = await db.select().from(leaderboardCurrent).where(eq(leaderboardCurrent.competitionId, comp.id));
  check("leaderboard has a row per team", lb.length === allTeams.length, `n=${lb.length}`);
  check("ranks start at 1", Math.min(...lb.map((r) => r.rank)) === 1);
  const sorted = [...lb].sort((x, y) => x.rank - y.rank);
  for (const r of sorted.slice(0, 3)) {
    const t = allTeams.find((x) => x.id === r.teamId)!;
    console.log(`    #${r.rank} ${t.name}  ${formatRupees(r.portfolioValuePaise)}  ${(r.returnBps / 100).toFixed(2)}%`);
  }

  console.log("\n=== 11. market closed rejects orders ===");
  await setMarketState(admin, comp.id, "paused");
  const closed = await placeOrder({
    teamId: team.id, symbol: "TCS", side: "buy", quantity: 1, idempotencyKey: randomUUID(),
  });
  check("order rejected while paused", !closed.ok && closed.code === "MARKET_CLOSED");
  const noTick = await runOneTick(comp.id);
  check("ticker does not advance while paused", noTick.ticked === false);

  console.log("\n=== 12. voiding a trade keeps the books balanced ===");
  await setMarketState(admin, comp.id, "closed");
  await openMarket(admin, comp.id, false);
  const voidTeam = allTeams[3]!;
  const b1 = await placeOrder({
    teamId: voidTeam.id, symbol: "ITC", side: "buy", quantity: 40, idempotencyKey: randomUUID() });
  await runOneTick(comp.id);
  const b2 = await placeOrder({
    teamId: voidTeam.id, symbol: "ITC", side: "buy", quantity: 25, idempotencyKey: randomUUID() });
  check("two buys at different prices filled", b1.ok && b2.ok);

  if (b1.ok) {
    await voidTrade(admin, b1.tradeId, "smoke test: bad fill");
    const bal = await db.execute(sql`
      SELECT (p.cash_paise
        + COALESCE((SELECT SUM(h.quantity::bigint * h.avg_cost_paise + h.cost_residual)
                    FROM holdings h WHERE h.portfolio_id = p.id), 0)
        + p.brokerage_paid_paise - p.realised_pnl_paise - ${comp.startingCashPaise}) AS diff
      FROM portfolios p WHERE p.team_id = ${voidTeam.id}`);
    const diff = Number((bal as unknown as Array<{ diff: string }>)[0]!.diff);
    check("cost basis still reconciles after voiding a buy", diff === 0, `drift=${formatRupees(diff)}`);
  }

  const sellRest = await placeOrder({
    teamId: voidTeam.id, symbol: "ITC", side: "sell", quantity: 25, idempotencyKey: randomUUID() });
  check("can still sell the shares the void left behind", sellRest.ok, sellRest.ok ? "" : sellRest.code);

  if (b2.ok) {
    let refused = false;
    try { await voidTrade(admin, b2.tradeId, "should be refused"); }
    catch { refused = true; }
    check("voiding a buy whose shares were already sold is refused", refused);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
