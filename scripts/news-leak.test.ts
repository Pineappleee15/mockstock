import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, sql as pg, stocks } from "../src/db";
import { publishNews } from "../src/lib/market";

/** The participant news API must never reveal which way a headline moves. */
async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const bank = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });

  await publishNews({ kind: "admin", id: 1, label: "test" }, comp.id, {
    headline: "A CRYPTIC CLUE THAT SHOULD GIVE NOTHING AWAY",
    impactBps: 700, decaySeconds: 120,
    stockIds: [bank[0]!.id],
  });

  const res = await fetch("http://127.0.0.1:3000/api/news?all=1");
  const body = await res.text();
  const json = JSON.parse(body) as { items: Array<Record<string, unknown>> };

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
  };

  const item = json.items[0]!;
  console.log("\n  payload keys:", Object.keys(item).join(", "));

  check("headline is delivered", String(item.headline).includes("CRYPTIC"));
  check("impactBps is absent from the item", !("impactBps" in item));
  check("no impact figure anywhere in the raw JSON", !body.includes("700"), body.includes("700") ? "found 700" : "");
  check("symbols still shown", Array.isArray(item.symbols) && (item.symbols as string[]).length > 0);

  console.log(`\n${failures === 0 ? "NO LEAK" : failures + " LEAKS FOUND"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
