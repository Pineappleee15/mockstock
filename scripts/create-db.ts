import "dotenv/config";
import postgres from "postgres";

/** Creates the mockstock database if it does not exist. */
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const target = url.pathname.slice(1);
  url.pathname = "/postgres";

  const admin = postgres(url.toString(), { max: 1 });
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${target}`;
  if (existing.length === 0) {
    await admin.unsafe(`CREATE DATABASE "${target}"`);
    console.log(`created database ${target}`);
  } else {
    console.log(`database ${target} already exists`);
  }
  await admin.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
