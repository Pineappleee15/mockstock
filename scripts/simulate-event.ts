import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql as pg, competitions, stocks, teams } from "../src/db";
import { openMarket, setMarketState } from "../src/lib/market";
import { runOneTick } from "../src/lib/ticker";
import { placeOrder } from "../src/lib/orders";
import { generateStoryline } from "../src/actions/admin";

/**
 * Runs a whole event end to end so the closing ceremony has real data to show.
 * Teams trade with different temperaments, so the standings are not a coin flip.
 */
const MINUTES = Number(process.argv[2] ?? 40);

async function main() {
  const comp = (await db.query.competitions.findFirst())!;
  const universe = await db.query.stocks.findMany({ where: eq(stocks.competitionId, comp.id) });
  const allTeams = await db.query.teams.findMany({ where: eq(teams.competitionId, comp.id) });

  console.log(`simulating ${MINUTES} minutes with ${allTeams.length} teams...`);

  await openMarket({ kind: "admin", id: 1, label: "sim" }, comp.id);

  const ticks = Math.round((MINUTES * 60) / comp.tickIntervalSeconds);
  // Each team gets a temperament: how often it trades and how much it likes risk.
  const temperament = allTeams.map((t, i) => ({
    team: t,
    eagerness: 0.05 + (i % 5) * 0.05,
    favourites: universe
      .filter((_, k) => (k + i) % (3 + (i % 4)) === 0)
      .slice(0, 5),
  }));

  for (let k = 1; k <= ticks; k++) {
    for (const t of temperament) {
      if (Math.random() > t.eagerness) continue;
      const stock = t.favourites[Math.floor(Math.random() * t.favourites.length)];
      if (!stock) continue;
      const side = Math.random() < 0.62 ? "buy" : "sell";
      const qty = 1 + Math.floor(Math.random() * 30);
      await placeOrder({
        teamId: t.team.id, symbol: stock.symbol, side,
        quantity: qty, idempotencyKey: randomUUID(),
      });
    }
    await runOneTick(comp.id);
    if (k % Math.max(1, Math.round(ticks / 6)) === 0) {
      process.stdout.write(`  ${Math.round((k / ticks) * 100)}%\n`);
    }
  }

  await setMarketState({ kind: "admin", id: 1, label: "sim" }, comp.id, "ended");
  const done = await db.query.competitions.findFirst({ where: eq(competitions.id, comp.id) });
  console.log(`\ndone. tick ${done!.currentTick}, state ${done!.state}`);
  await pg.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
