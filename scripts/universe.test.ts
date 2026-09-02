import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { db, sql as pg, stocks } from "../src/db";
import universe from "../src/data/universe.json";

/** The standard universe must stay balanced, and loading it must be idempotent. */
async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
  };

  console.log("\n=== baseline shape ===");
  const bySector = new Map<string, string[]>();
  for (const s of universe.stocks) {
    bySector.set(s.sector, [...(bySector.get(s.sector) ?? []), s.symbol]);
  }
  for (const [sector, syms] of [...bySector].sort()) {
    console.log(`   ${String(syms.length).padStart(2)}  ${sector}`);
    check(`${sector} has 3-4 stocks`, syms.length >= 3 && syms.length <= 4, `${syms.length}`);
  }
  const symbols = universe.stocks.map((s) => s.symbol);
  check("no duplicate symbols", new Set(symbols).size === symbols.length);
  check("every stock has a positive price", universe.stocks.every((s) => s.price > 0));
  check("every stock has positive volatility", universe.stocks.every((s) => s.volBps > 0));

  console.log("\n=== loading into a competition ===");
  const comp = (await db.query.competitions.findFirst())!;
  const before = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  check("seeded competition already has the full universe",
    before.length === universe.stocks.length, `${before.length} of ${universe.stocks.length}`);

  // Drop three, reload, and confirm exactly those three come back.
  const dropped = before.slice(0, 3).map((s) => s.symbol);
  // inArray, not a raw ANY(): drizzle expands a JS array into separate
  // placeholders, which Postgres rejects on the right of ANY.
  await db.delete(stocks).where(
    and(eq(stocks.competitionId, comp.id), inArray(stocks.symbol, dropped)));
  const after = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  check("three stocks removed", after.length === before.length - 3, `${after.length}`);

  const have = new Set(after.map((s) => s.symbol));
  const missing = universe.stocks.filter((s) => !have.has(s.symbol)).map((s) => s.symbol);
  check("loader would re-add exactly the missing three",
    missing.length === 3 && missing.every((m) => dropped.includes(m)), missing.join(", "));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
