import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, sql as pg, teams, stocks, watchlist } from "../src/db";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

async function main() {
  const team = (await db.query.teams.findFirst())!;
  const all = await db.query.stocks.findMany({ where: eq(stocks.competitionId, team.competitionId) });
  const [a, b] = all;

  const star = (stockId: number) =>
    db.insert(watchlist).values({ teamId: team.id, stockId }).onConflictDoNothing();
  const count = async () =>
    (await db.select().from(watchlist).where(eq(watchlist.teamId, team.id))).length;

  await db.delete(watchlist).where(eq(watchlist.teamId, team.id));

  console.log("\n=== starring ===");
  await star(a!.id);
  await star(b!.id);
  check("two stocks starred", (await count()) === 2, String(await count()));

  // Two phones on the same team login can tap the same star at once.
  await Promise.all([star(a!.id), star(a!.id), star(a!.id)]);
  check("starring the same stock repeatedly stays one row", (await count()) === 2, String(await count()));

  await db.delete(watchlist)
    .where(and(eq(watchlist.teamId, team.id), eq(watchlist.stockId, a!.id)));
  check("unstarring removes exactly one", (await count()) === 1, String(await count()));

  console.log("\n=== cleanup on delete ===");
  const other = (await db.query.teams.findMany())[1]!;
  await db.insert(watchlist).values({ teamId: other.id, stockId: b!.id }).onConflictDoNothing();
  await db.delete(teams).where(eq(teams.id, other.id));
  const orphans = await db.select().from(watchlist).where(eq(watchlist.teamId, other.id));
  check("deleting a team removes its watchlist", orphans.length === 0, String(orphans.length));

  const survivors = await db.select().from(watchlist).where(eq(watchlist.teamId, team.id));
  check("other teams' watchlists untouched", survivors.length === 1, String(survivors.length));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
  await pg.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
