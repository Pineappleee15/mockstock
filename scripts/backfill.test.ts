import "dotenv/config";
import { and, eq, lt } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, priceTicks } from "../src/db";
import { openMarket, setMarketState } from "../src/lib/market";

/** Stocks that somehow have no pre-open history must get it at market open. */
async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
  };

  const comp = (await db.query.competitions.findFirst())!;
  const all = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  const victim = all[0]!;

  // Simulate a stock created before history generation existed.
  await db.delete(priceTicks).where(
    and(eq(priceTicks.stockId, victim.id), lt(priceTicks.tickIndex, 0)));

  const before = await db.select().from(priceTicks).where(
    and(eq(priceTicks.stockId, victim.id), lt(priceTicks.tickIndex, 0)));
  check(`${victim.symbol} has no history to start with`, before.length === 0, `${before.length}`);

  await setMarketState({ kind: "admin", id: 1, label: "test" }, comp.id, "closed");
  await openMarket({ kind: "admin", id: 1, label: "test" }, comp.id);

  const after = await db.select().from(priceTicks).where(
    and(eq(priceTicks.stockId, victim.id), lt(priceTicks.tickIndex, 0)));
  check("history was backfilled at market open", after.length === 60, `${after.length} days`);
  check("history is positive integers", after.every((r) => Number.isInteger(r.pricePaise) && r.pricePaise > 0));

  const others = await db.select().from(priceTicks).where(
    and(eq(priceTicks.stockId, all[1]!.id), lt(priceTicks.tickIndex, 0)));
  check("stocks that already had history keep exactly one copy", others.length === 60, `${others.length}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
