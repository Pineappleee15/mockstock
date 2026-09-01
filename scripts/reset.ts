import "dotenv/config";
import { db, sql as pg } from "../src/db";
import { sql } from "drizzle-orm";

/**
 * Wipe all competition data. Keeps admins so you don't lock yourself out.
 * The ON DELETE CASCADE chain means deleting competitions removes everything
 * that belongs to one; audit_log is truncated separately because its
 * append-only trigger blocks DELETE.
 */
async function main() {
  await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update`);
  await db.execute(sql`TRUNCATE audit_log RESTART IDENTITY CASCADE`);
  await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update`);
  await db.execute(sql`TRUNCATE competitions RESTART IDENTITY CASCADE`);
  console.log("all competition data cleared (admins kept)");
  await pg.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
