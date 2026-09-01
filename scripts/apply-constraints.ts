import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const ddl = readFileSync("drizzle/constraints.sql", "utf8");
  await sql.unsafe(ddl);
  console.log("constraints applied");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
