import { and, eq, sql } from "drizzle-orm";
import {
  db, competitions, stocks, priceTicks, priceAdjustments, newsEvents, newsEventStocks,
  trades, portfolios, holdings, cashAdjustments, type Conn,
} from "@/db";
import { audit } from "./audit";
import { recomputeLeaderboard } from "./leaderboard";
import { priceHistory } from "./fundamentals";

type Admin = { kind: "admin"; id: number; label: string };

/**
 * Open the market.
 *
 * Captures each stock's session open price (the circuit-breaker reference) and
 * writes tick 0 so there is a published price before anyone can trade. Both
 * happen in the same transaction as the state change, so there is no window
 * where the market is open but priceless.
 */
export async function openMarket(actor: Admin, competitionId: number, rebase = true): Promise<void> {
  await db.transaction(async (tx) => {
    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) throw new Error("COMPETITION_NOT_FOUND");

    const all = await tx.query.stocks.findMany({ where: eq(stocks.competitionId, competitionId) });
    const firstOpen = comp.currentTick === 0;

    if (firstOpen || rebase) {
      // Session open = current price if we already have one, else the starting price.
      for (const s of all) {
        const last = await tx.query.priceTicks.findFirst({
          where: and(eq(priceTicks.stockId, s.id), eq(priceTicks.tickIndex, comp.currentTick)),
        });
        await tx.update(stocks)
          .set({ sessionOpenPaise: last?.pricePaise ?? s.startingPricePaise })
          .where(eq(stocks.id, s.id));
      }
    }

    if (firstOpen) {
      await tx.insert(priceTicks).values(all.map((s) => ({
        competitionId, stockId: s.id, tickIndex: 0,
        pricePaise: s.startingPricePaise, anchorPaise: s.startingPricePaise,
        gapBps: 0, netQty: 0, halted: s.status === "halted",
      }))).onConflictDoNothing();
      await recomputeLeaderboard(tx, competitionId, 0, comp.startingCashPaise);
    }

    await tx.update(competitions)
      .set({ state: "open", lastTickAt: new Date(), sessionOpenedAt: new Date(), updatedAt: new Date() })
      .where(eq(competitions.id, competitionId));

    await audit(actor, "market.open", { competitionId, payload: { rebase, firstOpen }, tx });
  });
}

/** Pause, resume, close or end. Pausing freezes prices because the clock only runs while open. */
export async function setMarketState(
  actor: Admin, competitionId: number, state: "pre_open" | "paused" | "closed" | "ended",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(competitions)
      .set({ state, updatedAt: new Date() })
      .where(eq(competitions.id, competitionId));
    await audit(actor, `market.${state}`, { competitionId, tx });
  });
}

/** Resume from pause: reset lastTickAt so catch-up does not replay the paused minutes. */
export async function resumeMarket(actor: Admin, competitionId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(competitions)
      .set({ state: "open", lastTickAt: new Date(), updatedAt: new Date() })
      .where(eq(competitions.id, competitionId));
    await audit(actor, "market.resume", { competitionId, tx });
  });
}

export async function haltStock(actor: Admin, stockId: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const s = await tx.query.stocks.findFirst({ where: eq(stocks.id, stockId) });
    if (!s) throw new Error("STOCK_NOT_FOUND");
    await tx.update(stocks)
      .set({ status: "halted", haltedAt: new Date(), haltReason: reason })
      .where(eq(stocks.id, stockId));
    await audit(actor, "stock.halt", {
      competitionId: s.competitionId, entityType: "stock", entityId: stockId,
      payload: { reason }, tx,
    });
  });
}

/**
 * Un-halt. Re-bases the session open to the current price by default, otherwise
 * a stock that hit its circuit limit is instantly re-halted on the next tick.
 */
export async function unhaltStock(actor: Admin, stockId: number, rebase = true): Promise<void> {
  await db.transaction(async (tx) => {
    const s = await tx.query.stocks.findFirst({ where: eq(stocks.id, stockId) });
    if (!s) throw new Error("STOCK_NOT_FOUND");
    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, s.competitionId) });
    const last = await tx.query.priceTicks.findFirst({
      where: and(eq(priceTicks.stockId, stockId), eq(priceTicks.tickIndex, comp?.currentTick ?? 0)),
    });
    await tx.update(stocks).set({
      status: "active", haltedAt: null, haltReason: null,
      ...(rebase && last ? { sessionOpenPaise: last.pricePaise } : {}),
    }).where(eq(stocks.id, stockId));
    await audit(actor, "stock.unhalt", {
      competitionId: s.competitionId, entityType: "stock", entityId: stockId,
      payload: { rebase, newSessionOpen: rebase ? last?.pricePaise : undefined }, tx,
    });
  });
}

/** Force a price. Persistent level shift: the walk continues from here. */
export async function overridePrice(
  actor: Admin, stockId: number, targetPaise: number, reason: string,
): Promise<void> {
  if (!reason?.trim()) throw new Error("REASON_REQUIRED");
  await db.transaction(async (tx) => {
    const s = await tx.query.stocks.findFirst({ where: eq(stocks.id, stockId) });
    if (!s) throw new Error("STOCK_NOT_FOUND");
    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, s.competitionId) });
    const tick = comp?.currentTick ?? 0;

    await tx.insert(priceTicks).values({
      competitionId: s.competitionId, stockId, tickIndex: tick,
      pricePaise: targetPaise, anchorPaise: targetPaise, gapBps: 0, netQty: 0,
      halted: s.status === "halted",
    }).onConflictDoUpdate({
      target: [priceTicks.stockId, priceTicks.tickIndex],
      set: { pricePaise: targetPaise, anchorPaise: targetPaise, gapBps: 0 },
    });

    await tx.insert(priceAdjustments).values({
      competitionId: s.competitionId, stockId, tickIndex: tick, kind: "override",
      targetPaise, reason, actorType: "admin", actorId: actor.id,
    });

    await audit(actor, "price.override", {
      competitionId: s.competitionId, entityType: "stock", entityId: stockId,
      payload: { targetPaise, reason, tick }, tx,
    });
  });
}

/** Publish a news event. The headline goes live for everyone on the same tick. */
export async function publishNews(
  actor: Admin, competitionId: number,
  input: { headline: string; body?: string; impactBps: number; decaySeconds: number; stockIds: number[] },
): Promise<number> {
  return db.transaction(async (tx) => {
    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) throw new Error("COMPETITION_NOT_FOUND");

    const ticks = Math.max(1, Math.ceil(input.decaySeconds / comp.tickIntervalSeconds));
    const startTick = comp.currentTick + 1;

    const [row] = await tx.insert(newsEvents).values({
      competitionId, headline: input.headline, body: input.body ?? null,
      impactBps: input.impactBps, decaySeconds: input.decaySeconds,
      startTick, endTick: startTick + ticks - 1, createdBy: actor.id,
    }).returning({ id: newsEvents.id });

    if (input.stockIds.length) {
      await tx.insert(newsEventStocks).values(
        input.stockIds.map((stockId) => ({ newsEventId: row!.id, stockId, impactBps: null })),
      );
    }

    await audit(actor, "news.publish", {
      competitionId, entityType: "news_event", entityId: row!.id,
      payload: { ...input, startTick, endTick: startTick + ticks - 1 }, tx,
    });
    return row!.id;
  });
}

/**
 * Void a trade.
 *
 * Reverses cash and quantity at the original fill price and recomputes average
 * cost. REFUSED if the reversal would push cash or holdings negative — that
 * happens when the team has already spent the proceeds or sold the shares on.
 * The admin is told to use a cash adjustment instead, rather than the app
 * silently creating a negative balance mid-event.
 */
export async function voidTrade(actor: Admin, tradeId: number, reason: string): Promise<void> {
  if (!reason?.trim()) throw new Error("REASON_REQUIRED");

  await db.transaction(async (tx) => {
    const trade = await tx.query.trades.findFirst({ where: eq(trades.id, tradeId) });
    if (!trade) throw new Error("TRADE_NOT_FOUND");
    if (trade.voidedAt) throw new Error("ALREADY_VOIDED");

    // Lock the portfolio, same discipline as the order path.
    const pfRows = await tx.execute(sql`
      SELECT id, cash_paise FROM portfolios WHERE team_id = ${trade.teamId} FOR UPDATE
    `);
    const pf = (pfRows as unknown as Array<Record<string, unknown>>)[0];
    if (!pf) throw new Error("PORTFOLIO_NOT_FOUND");
    const portfolioId = Number(pf.id);
    const cash = Number(pf.cash_paise);

    const holding = await tx.query.holdings.findFirst({
      where: and(eq(holdings.portfolioId, portfolioId), eq(holdings.stockId, trade.stockId)),
    });
    const heldQty = holding?.quantity ?? 0;

    // Undo the cash movement and the quantity movement.
    const cashAfter = cash - trade.cashDeltaPaise;
    const qtyAfter = trade.side === "buy" ? heldQty - trade.quantity : heldQty + trade.quantity;

    if (cashAfter < 0) {
      throw new Error("VOID_WOULD_OVERDRAW: team has already spent the proceeds. Adjust cash instead.");
    }
    if (qtyAfter < 0) {
      throw new Error("VOID_WOULD_SHORT: team has already sold those shares. Adjust cash instead.");
    }

    await tx.update(trades)
      .set({ voidedAt: new Date(), voidReason: reason, voidedBy: actor.id })
      .where(eq(trades.id, tradeId));

    // Reversing the quantity is not enough: the cost basis has to be unwound too,
    // or `cash + cost basis + fees = starting cash + realised P&L` stops holding
    // and every subsequent P&L figure for this team is quietly wrong.
    if (holding) {
      const oldTotalCost = holding.quantity * holding.avgCostPaise + holding.costResidual;
      const costDelta = trade.side === "buy"
        ? -trade.grossPaise                                    // un-buy: remove what it cost
        : trade.quantity * (trade.avgCostAtFill ?? holding.avgCostPaise); // un-sell: put the basis back
      const newTotalCost = Math.max(0, oldTotalCost + costDelta);

      await tx.update(holdings).set({
        quantity: qtyAfter,
        avgCostPaise: qtyAfter > 0 ? Math.floor(newTotalCost / qtyAfter) : 0,
        costResidual: qtyAfter > 0 ? newTotalCost % qtyAfter : 0,
        updatedAt: new Date(),
      }).where(eq(holdings.id, holding.id));
    } else if (trade.side === "sell") {
      // The position was fully exited and the row is gone; recreate it.
      await tx.insert(holdings).values({
        portfolioId, stockId: trade.stockId, quantity: qtyAfter,
        avgCostPaise: trade.avgCostAtFill ?? 0, costResidual: 0,
      });
    }

    await tx.update(portfolios).set({
      cashPaise: cashAfter,
      realisedPnlPaise: sql`${portfolios.realisedPnlPaise} - ${trade.realisedPnlPaise}`,
      brokeragePaidPaise: sql`${portfolios.brokeragePaidPaise} - ${trade.brokeragePaise}`,
      tradeCount: sql`GREATEST(0, ${portfolios.tradeCount} - 1)`,
      updatedAt: new Date(),
    }).where(eq(portfolios.id, portfolioId));

    await audit(actor, "trade.void", {
      competitionId: trade.competitionId, entityType: "trade", entityId: tradeId,
      payload: { reason, cashReversed: trade.cashDeltaPaise, qtyReversed: trade.quantity }, tx,
    });
  });
}

/** Adjust a team's cash. Reason is mandatory and recorded twice: its own table and the audit log. */
export async function adjustCash(
  actor: Admin, teamId: number, amountPaise: number, reason: string,
): Promise<void> {
  if (!reason?.trim()) throw new Error("REASON_REQUIRED");
  await db.transaction(async (tx) => {
    const pfRows = await tx.execute(sql`
      SELECT id, competition_id, cash_paise FROM portfolios WHERE team_id = ${teamId} FOR UPDATE
    `);
    const pf = (pfRows as unknown as Array<Record<string, unknown>>)[0];
    if (!pf) throw new Error("PORTFOLIO_NOT_FOUND");

    const competitionId = Number(pf.competition_id);
    const after = Number(pf.cash_paise) + amountPaise;
    if (after < 0) throw new Error("ADJUSTMENT_WOULD_OVERDRAW");

    await tx.update(portfolios)
      .set({ cashPaise: after, updatedAt: new Date() })
      .where(eq(portfolios.id, Number(pf.id)));

    await tx.insert(cashAdjustments).values({
      competitionId, teamId, amountPaise, reason, createdBy: actor.id,
    });

    await audit(actor, "cash.adjust", {
      competitionId, entityType: "team", entityId: teamId,
      payload: { amountPaise, reason, cashAfter: after }, tx,
    });
  });
}

/**
 * Write a stock's pre-open price history.
 *
 * Stored as price_ticks at NEGATIVE tick indices, which needs no schema change
 * and keeps "before the bell" naturally separate from the live session: the
 * session clock starts at zero, so change-since-open and the circuit breaker
 * are unaffected by anything here.
 */
export async function writeStockHistory(
  tx: Conn, competitionId: number, stock: typeof stocks.$inferSelect, days = 60,
): Promise<void> {
  const series = priceHistory(
    competitionId, stock.symbol, stock.startingPricePaise,
    stock.volatilityBps, stock.driftBps, days,
  );

  // series ends on the opening price; that value is tick 0, written at open.
  const rows = series.slice(0, -1).map((price, i) => ({
    competitionId,
    stockId: stock.id,
    tickIndex: -(days - i),
    pricePaise: price,
    anchorPaise: price,
    gapBps: 0,
    netQty: 0,
    halted: false,
  }));

  if (rows.length) await tx.insert(priceTicks).values(rows).onConflictDoNothing();
}
