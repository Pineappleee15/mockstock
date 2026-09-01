import "dotenv/config";
import { db, sql as pg } from "../src/db";
import { openMarket } from "../src/lib/market";

/** Convenience for testing and for the runbook's dry run. */
async function main() {
  const c = await db.query.competitions.findFirst();
  if (!c) throw new Error("no competition");
  await openMarket({ kind: "admin", id: 1, label: "cli" }, c.id);
  console.log(`market opened for competition ${c.id} (${c.name})`);
  await pg.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
