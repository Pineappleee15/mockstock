/**
 * Runs once at container start, before the server accepts traffic.
 *
 *   1. applies any pending SQL migrations
 *   2. applies the hand-written constraints (partial indexes, audit trigger)
 *   3. creates the admin account if none exists
 *
 * Plain .mjs so it needs no TypeScript loader in production, and idempotent so
 * a redeploy is always safe.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { hash } from "@node-rs/argon2";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[deploy-init] DATABASE_URL is not set. Add the Postgres plugin and reference it.");
  process.exit(1);
}

// Same TLS rule as src/db/index.ts: hosted Postgres needs it, the vendored
// local database cannot do it.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: isLocal ? false : "require" });

try {
  console.log("[deploy-init] applying migrations...");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });

  console.log("[deploy-init] applying constraints...");
  await sql.unsafe(readFileSync("drizzle/constraints.sql", "utf8"));

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM admins`;
  if (count === 0) {
    if (!username || !password) {
      console.error("[deploy-init] No admin exists and ADMIN_USERNAME / ADMIN_PASSWORD are not set.");
      console.error("[deploy-init] Set them in the Railway variables and redeploy, or you cannot sign in.");
      process.exit(1);
    }
    if (password.length < 8) {
      console.error("[deploy-init] ADMIN_PASSWORD must be at least 8 characters.");
      process.exit(1);
    }
    await sql`
      INSERT INTO admins (username, password_hash, display_name)
      VALUES (${username}, ${await hash(password)}, 'Finance Cell')
    `;
    console.log(`[deploy-init] created admin "${username}"`);
  } else {
    console.log(`[deploy-init] ${count} admin account(s) already exist, leaving them alone`);
  }

  // Optional: populate a demo competition so a fresh deploy is immediately
  // usable. Only ever runs when there are no competitions at all, so leaving
  // the variable set cannot clobber a real event.
  if (process.env.SEED_DEMO === "true") {
    const [{ count: comps }] = await sql`SELECT COUNT(*)::int AS count FROM competitions`;
    if (comps === 0) {
      await seedDemo(sql);
      console.log("[deploy-init] seeded the demo competition");
    } else {
      console.log("[deploy-init] SEED_DEMO set but a competition already exists, skipping");
    }
  }

  console.log("[deploy-init] ready");
} catch (err) {
  console.error("[deploy-init] failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}


/* ─────────────────────────  demo seeding  ───────────────────────── */

/** FNV-1a, matching src/lib/rng.ts so seeds are reproducible either way. */
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function joinCode(i) {
  // Declared inside the function: this module has top-level await, so the main
  // body runs before any module-level `const` below it is initialised.
  // No 0/O and no 1/I/l, because these get read off a projector.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = seedFromString(`mockstock-team-${i}`);
  let out = "";
  for (let k = 0; k < 6; k++) {
    out += alphabet[h % alphabet.length];
    h = Math.floor(h / 7) + 13;
  }
  return out;
}

async function seedDemo(sql) {
  const demo = JSON.parse(readFileSync("scripts/demo-data.json", "utf8"));
  const startingCash = 100_000_000; // Rs 10,00,000 in paise

  const [comp] = await sql`
    INSERT INTO competitions (name, mode, state, starting_cash_paise, starts_at, ends_at)
    VALUES ('MockStock Demo Event', 'event', 'draft', ${startingCash},
            now(), now() + interval '4 hours')
    RETURNING id
  `;

  // Liquidity notional assumes a 10-team demo. Scale it with team count for a
  // real event — see RUNBOOK section 1.
  const LIQUIDITY_NOTIONAL_PAISE = 200_000_000;

  for (const s of demo.stocks) {
    const pricePaise = Math.round(s.price * 100);
    await sql`
      INSERT INTO stocks (competition_id, symbol, name, sector, starting_price_paise,
                          volatility_bps, drift_bps, liquidity, seed)
      VALUES (${comp.id}, ${s.symbol}, ${s.name}, ${s.sector}, ${pricePaise},
              ${s.volBps}, 0,
              ${Math.max(10, Math.round(LIQUIDITY_NOTIONAL_PAISE / pricePaise))},
              ${seedFromString(`${comp.id}:${s.symbol}`) % 2_000_000_000})
    `;
  }

  for (let i = 0; i < demo.teams.length; i++) {
    const t = demo.teams[i];
    const [team] = await sql`
      INSERT INTO teams (competition_id, name, members, join_code)
      VALUES (${comp.id}, ${t.name}, ${t.members}, ${joinCode(i)})
      RETURNING id
    `;
    await sql`
      INSERT INTO portfolios (competition_id, team_id, cash_paise)
      VALUES (${comp.id}, ${team.id}, ${startingCash})
    `;
  }
}
