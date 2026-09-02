import "dotenv/config";
import { eq, and, sql } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, newsEvents } from "../src/db";
import { openMarket } from "../src/lib/market";
import { runOneTick } from "../src/lib/ticker";
import { planStoryline } from "../src/lib/storyline";
import { newsFeed } from "../src/lib/queries";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const universe = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });

  console.log("\n=== planning ===");
  const plan = planStoryline(
    comp.id, universe.map((s) => ({ id: s.id, symbol: s.symbol, name: s.name, sector: s.sector })),
    180, comp.tickIntervalSeconds, { maxImpactPct: 4.5 });
  check("produced a schedule", plan.length > 8, `${plan.length} headlines`);
  check("no headline exceeds the cap", plan.every((b) => Math.abs(b.impactBps) <= 450));
  check("every beat targets at least one stock", plan.every((b) => b.stockIds.length > 0));
  check("beats are ordered in time", plan.every((b, i) => i === 0 || b.tick >= plan[i - 1]!.tick));
  check("no story repeats in a session",
    new Set(plan.map((b) => b.arcId.split("-").slice(2).join("-"))).size ===
    new Set(plan.map((b) => b.arcId)).size,
    `${new Set(plan.map((b) => b.arcId)).size} stories`);
  check("no placeholders left unresolved",
    plan.every((b) => !/[{}]/.test(b.headline)),
    plan.find((b) => /[{}]/.test(b.headline))?.headline ?? "");

  console.log("\n=== queue stays hidden until its slot ===");
  // Queue two: one due immediately, one far in the future.
  await db.delete(newsEvents).where(eq(newsEvents.competitionId, comp.id));
  const [soon] = await db.insert(newsEvents).values({
    competitionId: comp.id, headline: "QUEUED EARLY", impactBps: 200, decaySeconds: 60,
    startTick: 1, endTick: 12, status: "queued", arcId: "t", arcStep: 1,
  }).returning({ id: newsEvents.id });
  await db.insert(newsEvents).values({
    competitionId: comp.id, headline: "QUEUED LATE", impactBps: 200, decaySeconds: 60,
    startTick: 9999, endTick: 10010, status: "queued", arcId: "t", arcStep: 2,
  });

  const beforeFeed = await newsFeed(comp, 20);
  check("queued news is invisible to teams before publishing",
    !beforeFeed.some((n) => n.headline.startsWith("QUEUED")), `${beforeFeed.length} visible`);

  await openMarket({ kind: "admin", id: 1, label: "test" }, comp.id);
  await runOneTick(comp.id);

  const after = await db.query.newsEvents.findFirst({ where: eq(newsEvents.id, soon!.id) });
  check("a due headline publishes itself", after?.status === "published", after?.status ?? "?");

  const late = await db.query.newsEvents.findFirst({
    where: and(eq(newsEvents.competitionId, comp.id), sql`headline = 'QUEUED LATE'`),
  });
  check("a future headline stays queued", late?.status === "queued", late?.status ?? "?");

  const afterFeed = await newsFeed(comp, 20);
  check("teams now see only the published one",
    afterFeed.some((n) => n.headline === "QUEUED EARLY") &&
    !afterFeed.some((n) => n.headline === "QUEUED LATE"));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
