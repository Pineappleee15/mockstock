import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, teams } from "../src/db";
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
  await openMarket({ kind: "admin", id: 1, label: "test" }, comp.id);
  await runOneTick(comp.id);

  console.log("\n=== queued buyers in one tick ===");
  const fills: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await placeOrder({
      teamId: allTeams[i]!.id, symbol: "TATASTEEL", side: "buy",
      quantity: 400, idempotencyKey: randomUUID(),
    });
    if (r.ok) fills.push(r.fillPricePaise);
  }
  fills.forEach((f, i) => console.log(`    buyer ${i + 1}: ${formatRupees(f)}`));

  check("all five filled", fills.length === 5, `${fills.length}`);
  check("each buyer pays more than the one before",
    fills.every((f, i) => i === 0 || f >= fills[i - 1]!),
    fills.map((f) => (f / 100).toFixed(2)).join(" -> "));
  check("the first mover pays less than the last", fills[0]! < fills[4]!,
    `${formatRupees(fills[0]!)} vs ${formatRupees(fills[4]!)}`);

  const gapPct = ((fills[4]! - fills[0]!) / fills[0]!) * 100;
  console.log(`    gap across five buyers: ${gapPct.toFixed(2)}%`);
  check("the gap is meaningful but not punishing", gapPct > 0.05 && gapPct < 4,
    `${gapPct.toFixed(2)}%`);

  console.log("\n=== selling pushes the other way ===");
  const sellFills: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await placeOrder({
      teamId: allTeams[i]!.id, symbol: "TATASTEEL", side: "sell",
      quantity: 300, idempotencyKey: randomUUID(),
    });
    if (r.ok) sellFills.push(r.fillPricePaise);
  }
  check("each seller receives less than the one before",
    sellFills.length === 3 && sellFills.every((f, i) => i === 0 || f <= sellFills[i - 1]!),
    sellFills.map((f) => (f / 100).toFixed(2)).join(" -> "));

  console.log("\n=== the slippage resets each tick ===");
  const before = (await db.query.stocks.findFirst({ where: eq(stocks.symbol, "TATASTEEL") }))!;
  check("slippage was recorded in the tick", before.intraTickBps !== 0, `${before.intraTickBps}bps`);

  await runOneTick(comp.id);
  const nextFill = await placeOrder({
    teamId: allTeams[6]!.id, symbol: "TATASTEEL", side: "buy",
    quantity: 1, idempotencyKey: randomUUID(),
  });
  const after = (await db.query.stocks.findFirst({ where: eq(stocks.symbol, "TATASTEEL") }))!;
  check("a new tick starts from a clean slate",
    Math.abs(after.intraTickBps) < Math.abs(before.intraTickBps) || after.intraTickAt !== before.intraTickAt,
    `${before.intraTickBps} -> ${after.intraTickBps}`);
  check("orders still fill in the new tick", nextFill.ok);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
