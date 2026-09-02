import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, teams, portfolios, admins } from "../src/db";
import { seedFromString } from "../src/lib/rng";
import { driftFor } from "../src/lib/fundamentals";
import { writeStockHistory } from "../src/lib/market";
import { rupeesToPaise } from "../src/lib/money";
import { DEMO_STOCKS, DEMO_TEAMS } from "./stocks-demo";

/**
 * Liquidity is expressed as "shares that must be net-bought in one tick to move
 * the price about 1%". We derive it from a notional rupee figure so cheap and
 * expensive stocks are equally movable.
 *
 * Rule of thumb for a real event: notional = teams x startingCash x 0.2.
 * 10 teams x 10L x 0.2 = 20L, which is the default below. For 300 teams you
 * want roughly 6 Cr, or a stampede will hit the circuit breaker instantly.
 */
const LIQUIDITY_NOTIONAL_PAISE = 200_000_000; // Rs 20 lakh

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function joinCode(i: number): string {
  // Deterministic per seed run so codes are stable across re-seeds in testing.
  let h = seedFromString(`mockstock-team-${i}`);
  let out = "";
  for (let k = 0; k < 6; k++) { out += ALPHABET[h % ALPHABET.length]; h = Math.floor(h / 7) + 13; }
  return out;
}

async function main() {
  console.log("seeding demo competition...");

  const adminUser = process.env.ADMIN_USERNAME ?? "admin";
  const adminPass = process.env.ADMIN_PASSWORD ?? "admin123";

  const existingAdmin = await db.query.admins.findFirst({ where: eq(admins.username, adminUser) });
  if (!existingAdmin) {
    await db.insert(admins).values({
      username: adminUser, passwordHash: await hash(adminPass), displayName: "Finance Cell",
    });
    console.log(`  admin created: ${adminUser} / ${adminPass}`);
  } else {
    console.log(`  admin ${adminUser} already exists`);
  }

  const startingCash = rupeesToPaise(1_000_000); // Rs 10,00,000

  const [comp] = await db.insert(competitions).values({
    name: "MockStock Demo Event",
    mode: "event",
    state: "draft",
    startingCashPaise: startingCash,
    brokerageBps: 5,
    spreadBps: 20,
    concentrationCapBps: 4000,
    orderRateLimitPerMin: 30,
    circuitLimitBps: 2000,
    sessionMinutes: 180,
    tickIntervalSeconds: 5,
    volatilityMultiplierBps: 10000,
    leaderboardEveryNTicks: 2,
    orderFlowEnabled: true,
    impactCoefficientBps: 100,
    maxImpactBpsPerTick: 200,
    gapHalflifeSeconds: 90,
    permanentImpactBps: 3000,
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  }).returning();

  console.log(`  competition #${comp!.id}: ${comp!.name}`);

  const insertedStocks = await db.insert(stocks).values(DEMO_STOCKS.map((s) => {
    const pricePaise = rupeesToPaise(s.price);
    return {
      competitionId: comp!.id,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      startingPricePaise: pricePaise,
      volatilityBps: s.volBps,
      driftBps: driftFor(comp!.id, s.symbol),
      liquidity: Math.max(10, Math.round(LIQUIDITY_NOTIONAL_PAISE / pricePaise)),
      seed: seedFromString(`${comp!.id}:${s.symbol}`) % 2_000_000_000,
    };
  })).returning();

  for (const row of insertedStocks) await writeStockHistory(db, comp!.id, row);
  console.log(`  ${DEMO_STOCKS.length} stocks, each with 60 days of history`);

  const teamRows = await db.insert(teams).values(DEMO_TEAMS.map((t, i) => ({
    competitionId: comp!.id,
    name: t.name,
    members: t.members,
    joinCode: joinCode(i),
  }))).returning();

  await db.insert(portfolios).values(teamRows.map((t) => ({
    competitionId: comp!.id, teamId: t.id, cashPaise: startingCash,
  })));

  console.log(`  ${teamRows.length} teams:`);
  for (const t of teamRows) console.log(`    ${t.joinCode}  ${t.name}`);

  console.log("\nseed complete. Log in as admin and press Open Market to start.");
  await pg.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
