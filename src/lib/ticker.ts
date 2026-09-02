import { and, eq, sql, inArray } from "drizzle-orm";
import {
  db, competitions, stocks, priceTicks, priceAdjustments, newsEvents, newsEventStocks, type Conn,
} from "@/db";
import { computeTick, pullbackBps, newsSchedule } from "./engine";
import type { EngineConfig, EngineStock, StockState } from "./engine-types";
import { recomputeLeaderboard, archiveLeaderboard } from "./leaderboard";
import { ticksDue, MAX_CATCHUP_TICKS } from "./tick-clock";
import { audit } from "./audit";

const ARCHIVE_EVERY_SECONDS = 300;

export function configOf(c: typeof competitions.$inferSelect): EngineConfig {
  return {
    tickIntervalSeconds: c.tickIntervalSeconds,
    volatilityMultiplierBps: c.volatilityMultiplierBps,
    orderFlowEnabled: c.orderFlowEnabled,
    impactCoefficientBps: c.impactCoefficientBps,
    maxImpactBpsPerTick: c.maxImpactBpsPerTick,
    gapHalflifeSeconds: c.gapHalflifeSeconds,
    permanentImpactBps: c.permanentImpactBps,
    circuitLimitBps: c.circuitLimitBps,
  };
}

/**
 * Advance one competition by exactly one tick, inside one transaction.
 *
 * Takes a transaction-scoped advisory lock so that if two processes ever run
 * (a Railway deploy overlap, or a stray `npm run dev`), only one ticks.
 * Transaction-scoped rather than session-scoped so it stays safe through a
 * connection pooler.
 */
export async function runOneTick(competitionId: number): Promise<{ ticked: boolean; tick: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${competitionId})`);

    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp || comp.state !== "open") return { ticked: false, tick: comp?.currentTick ?? 0 };

    const prevTick = comp.currentTick;
    const nextTick = prevTick + 1;
    const cfg = configOf(comp);
    const pullback = pullbackBps(cfg);

    const allStocks = await tx.query.stocks.findMany({
      where: eq(stocks.competitionId, competitionId),
    });
    if (allStocks.length === 0) return { ticked: false, tick: prevTick };

    // Previous tick state per stock. Missing (first tick) falls back to the
    // starting price, which is also how a stock added mid-event behaves.
    const prevRows = await tx.select().from(priceTicks)
      .where(and(eq(priceTicks.competitionId, competitionId), eq(priceTicks.tickIndex, prevTick)));
    const prevByStock = new Map(prevRows.map((r) => [r.stockId, r]));

    // Net signed quantity traded during the previous tick, excluding voided
    // trades. This is the primary price driver.
    const flowRows = await tx.execute<{ stock_id: string; net: string }>(sql`
      SELECT stock_id, SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END)::bigint AS net
      FROM trades
      WHERE competition_id = ${competitionId} AND tick_index = ${prevTick} AND voided_at IS NULL
      GROUP BY stock_id
    `);
    const flowByStock = new Map<number, number>();
    for (const r of flowRows as unknown as Array<{ stock_id: string; net: string }>) {
      flowByStock.set(Number(r.stock_id), Number(r.net));
    }

    // News increments landing on this tick.
    const newsDelta = await newsDeltasForTick(tx, competitionId, nextTick, comp.tickIntervalSeconds);

    const tickRows: (typeof priceTicks.$inferInsert)[] = [];
    const adjustments: (typeof priceAdjustments.$inferInsert)[] = [];
    const newlyHalted: number[] = [];

    for (const s of allStocks) {
      const prev = prevByStock.get(s.id);
      const state: StockState = prev
        ? { pricePaise: prev.pricePaise, anchorPaise: prev.anchorPaise, gapBps: prev.gapBps }
        : { pricePaise: s.startingPricePaise, anchorPaise: s.startingPricePaise, gapBps: 0 };

      const engineStock: EngineStock = {
        id: s.id, seed: s.seed, volatilityBps: s.volatilityBps, driftBps: s.driftBps,
        liquidity: s.liquidity, circuitLimitBps: s.circuitLimitBps,
        sessionOpenPaise: s.sessionOpenPaise, halted: s.status === "halted",
      };

      const netQty = flowByStock.get(s.id) ?? 0;
      const news = newsDelta.get(s.id) ?? 0;

      const out = computeTick(
        { tickIndex: nextTick, state, stock: engineStock, netQty, newsDeltaBps: news },
        cfg, pullback,
      );

      tickRows.push({
        competitionId, stockId: s.id, tickIndex: nextTick,
        pricePaise: out.state.pricePaise, anchorPaise: out.state.anchorPaise,
        gapBps: out.state.gapBps, netQty: out.netQty, halted: out.halted,
      });

      if (out.impactBps !== 0) {
        adjustments.push({
          competitionId, stockId: s.id, tickIndex: nextTick, kind: "order_flow",
          deltaBps: out.impactBps, netQty, actorType: "system",
        });
      }
      if (news !== 0) {
        adjustments.push({
          competitionId, stockId: s.id, tickIndex: nextTick, kind: "news",
          deltaBps: news, actorType: "system",
        });
      }
      if (out.breachedCircuit && s.status !== "halted") newlyHalted.push(s.id);
    }

    await tx.insert(priceTicks).values(tickRows).onConflictDoNothing();
    if (adjustments.length) await tx.insert(priceAdjustments).values(adjustments);

    if (newlyHalted.length) {
      await tx.update(stocks)
        .set({ status: "halted", haltedAt: new Date(), haltReason: "Circuit breaker" })
        .where(inArray(stocks.id, newlyHalted));
      for (const id of newlyHalted) {
        await audit({ kind: "system" }, "stock.halt", {
          competitionId, entityType: "stock", entityId: id,
          payload: { reason: "circuit_breaker", tick: nextTick }, tx,
        });
      }
    }

    // Advance the clock by exactly one interval rather than to "now", so the
    // tick cadence does not drift by however long each tick took, and so a
    // catch-up replay walks forward one interval at a time.
    const intervalMs = comp.tickIntervalSeconds * 1000;
    const previous = comp.lastTickAt?.getTime() ?? Date.now();
    const advanced = new Date(Math.min(Date.now(), previous + intervalMs));

    await tx.update(competitions)
      .set({ currentTick: nextTick, lastTickAt: advanced })
      .where(eq(competitions.id, competitionId));

    if (nextTick % comp.leaderboardEveryNTicks === 0) {
      await recomputeLeaderboard(tx, competitionId, nextTick, comp.startingCashPaise);
      const archiveEvery = Math.max(1, Math.round(ARCHIVE_EVERY_SECONDS / comp.tickIntervalSeconds));
      if (nextTick % archiveEvery === 0) {
        await archiveLeaderboard(tx, competitionId, nextTick);
      }
    }

    return { ticked: true, tick: nextTick };
  });
}

/**
 * News impact landing on each stock at `tick`.
 *
 * The schedule is recomputed from the event definition rather than stored, so
 * it is identical on a replay after a crash. Increments sum to exactly the
 * requested impact (see newsSchedule).
 */
async function newsDeltasForTick(
  tx: Conn, competitionId: number, tick: number, tickIntervalSeconds: number,
): Promise<Map<number, number>> {
  const active = await tx.select({
    id: newsEvents.id,
    impactBps: newsEvents.impactBps,
    startTick: newsEvents.startTick,
    endTick: newsEvents.endTick,
    decaySeconds: newsEvents.decaySeconds,
    stockId: newsEventStocks.stockId,
    stockImpactBps: newsEventStocks.impactBps,
  })
    .from(newsEvents)
    .innerJoin(newsEventStocks, eq(newsEventStocks.newsEventId, newsEvents.id))
    .where(and(
      eq(newsEvents.competitionId, competitionId),
      sql`${newsEvents.startTick} <= ${tick}`,
      sql`${newsEvents.endTick} >= ${tick}`,
    ));

  const out = new Map<number, number>();
  for (const row of active) {
    const ticks = Math.max(1, Math.ceil(row.decaySeconds / tickIntervalSeconds));
    const total = row.stockImpactBps ?? row.impactBps;
    const schedule = newsSchedule(total, ticks);
    const offset = tick - row.startTick;
    if (offset < 0 || offset >= schedule.length) continue;
    out.set(row.stockId, (out.get(row.stockId) ?? 0) + schedule[offset]!);
  }
  return out;
}

/* ────────────────────────  the interval loop  ──────────────────────── */

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the in-process ticker.
 *
 * One setInterval for the whole app. If a cycle overruns its interval the next
 * one is SKIPPED rather than queued — the recurrence catches up by replaying
 * missed ticks, so there is no drift and no pile-up.
 */
export function startTicker(): void {
  if (timer) return;
  if (process.env.TICKER_ENABLED === "false") {
    console.log("[ticker] disabled by TICKER_ENABLED=false");
    return;
  }

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const live = await db.query.competitions.findFirst({ where: eq(competitions.state, "open") });
      if (!live) return;

      const now = Date.now();
      const plan = ticksDue(live.lastTickAt, now, live.tickIntervalSeconds);
      if (plan.due <= 0) return;

      if (plan.skipped > 0) {
        // The market was left open while nothing was ticking — the process was
        // asleep (Render's free tier stops after 15 idle minutes), not merely
        // busy. Move the clock forward before replaying, otherwise every poll
        // replays the cap and never catches up, churning through days of
        // invented price history for a market nobody could trade in.
        await db.update(competitions)
          .set({ lastTickAt: new Date(now - MAX_CATCHUP_TICKS * live.tickIntervalSeconds * 1000) })
          .where(eq(competitions.id, live.id));
        console.warn(
          `[ticker] market was open but idle for ${Math.round(plan.gapSeconds / 60)} minutes; ` +
          `skipped ${plan.skipped} ticks and resumed from the last ${MAX_CATCHUP_TICKS}`,
        );
      }

      for (let i = 0; i < plan.due; i++) {
        const res = await runOneTick(live.id);
        if (!res.ticked) break;
      }
    } catch (e) {
      console.error("[ticker] cycle failed", e);
    } finally {
      running = false;
    }
  };

  // Poll at 1s and let each competition's own interval decide what is due, so
  // changing tick_interval_seconds mid-event takes effect without a restart.
  timer = setInterval(() => { void poll(); }, 1000);
  console.log("[ticker] started");
}

export function stopTicker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
