import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, newsEvents, newsEventStocks } from "../src/db";

/** Verifies the ticker window: fresh headlines scroll, stale ones drop off. */
async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const bank = await db.query.stocks.findFirst({
    where: eq(stocks.competitionId, comp.id),
  });

  const make = async (headline: string, minutesAgo: number, impactBps: number) => {
    const [row] = await db.insert(newsEvents).values({
      competitionId: comp.id, headline, impactBps, decaySeconds: 120,
      startTick: comp.currentTick + 1, endTick: comp.currentTick + 25,
    }).returning({ id: newsEvents.id });
    await db.insert(newsEventStocks).values({ newsEventId: row!.id, stockId: bank!.id });
    await db.execute(sql`
      UPDATE news_events SET published_at = now() - (${minutesAgo} * interval '1 minute')
      WHERE id = ${row!.id}`);
    return row!.id;
  };

  await make("STALE: published thirty minutes ago", 30, 300);
  await make("STALE: published twenty minutes ago", 20, -200);
  await make("FRESH: just published", 0, 0);

  const base = "http://127.0.0.1:3000/api/news";
  const ticker = await (await fetch(base)).json();
  const all = await (await fetch(base + "?all=1")).json();

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
  };

  const tickerHeadlines = ticker.items.map((i: { headline: string }) => i.headline);
  const allHeadlines = all.items.map((i: { headline: string }) => i.headline);

  console.log("\n=== ticker (last 15 minutes) ===");
  for (const h of tickerHeadlines) console.log("   ", h);
  check("ticker shows the fresh headline", tickerHeadlines.some((h: string) => h.startsWith("FRESH")));
  check("ticker drops both stale headlines",
    !tickerHeadlines.some((h: string) => h.startsWith("STALE")), `n=${tickerHeadlines.length}`);
  check("ticker window is reported", ticker.windowMinutes === 15, String(ticker.windowMinutes));

  console.log("\n=== news page (full history) ===");
  for (const h of allHeadlines) console.log("   ", h);
  check("history keeps everything", allHeadlines.length >= 3, `n=${allHeadlines.length}`);
  check("history is newest first", allHeadlines[0]!.startsWith("FRESH"));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
