import { and, eq, sql } from "drizzle-orm";
import {
  db, competitions, stocks, portfolios, holdings, orders, trades, priceTicks, type Conn,
} from "@/db";
import { applySpread, brokerageFor, mergeAverageCost, BPS } from "./money";
import { audit } from "./audit";

export type RejectCode =
  | "MARKET_CLOSED" | "STOCK_HALTED" | "UNKNOWN_SYMBOL" | "INVALID_QUANTITY"
  | "INSUFFICIENT_CASH" | "INSUFFICIENT_HOLDINGS" | "CONCENTRATION_CAP"
  | "RATE_LIMITED" | "NO_PRICE" | "SHORTING_DISABLED";

export type OrderResult =
  | {
      ok: true; replayed: boolean; orderId: number; tradeId: number;
      side: "buy" | "sell"; symbol: string; quantity: number;
      fillPricePaise: number; grossPaise: number; brokeragePaise: number;
      cashAfterPaise: number; realisedPnlPaise: number;
    }
  | { ok: false; replayed: boolean; code: RejectCode; detail: string };

export interface OrderRequest {
  teamId: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  idempotencyKey: string;
}

/**
 * How much a single fill moves the price for the next order in the same tick.
 *
 * A quarter of the per-tick impact coefficient, so being first is worth
 * something without turning a five-second window into a race that punishes
 * anyone on a slow phone. Capped so a burst cannot run the price away.
 */
const FIRST_MOVER_COEFF_BPS = 25;
const MAX_INTRA_TICK_BPS = 120;

/** Slippage this order leaves behind for whoever comes next. */
export function intraTickSlipBps(
  quantity: number, side: "buy" | "sell", liquidity: number, enabled: boolean,
): number {
  if (!enabled || quantity <= 0) return 0;
  const magnitude = Math.sqrt(quantity / Math.max(1, liquidity));
  const signed = (side === "buy" ? 1 : -1) * FIRST_MOVER_COEFF_BPS * magnitude;
  return Math.round(Math.max(-MAX_INTRA_TICK_BPS, Math.min(MAX_INTRA_TICK_BPS, signed)));
}

export const REJECT_DETAIL: Record<RejectCode, string> = {
  MARKET_CLOSED: "The market is not open for trading right now.",
  STOCK_HALTED: "Trading in this stock is halted.",
  UNKNOWN_SYMBOL: "No such stock in this competition.",
  INVALID_QUANTITY: "Quantity must be a whole number of at least 1.",
  INSUFFICIENT_CASH: "Not enough cash for this order including fees.",
  INSUFFICIENT_HOLDINGS: "You do not hold that many shares.",
  SHORTING_DISABLED: "Short selling is off. You can only sell what you hold.",
  CONCENTRATION_CAP: "This would put too much of your portfolio in one stock.",
  RATE_LIMITED: "Too many orders in the last minute. Slow down.",
  NO_PRICE: "No price has been published for this stock yet.",
};

/**
 * Post-trade concentration check (PLAN.md section 4).
 *
 * Measured on the portfolio AS IT WOULD BE after this fill, so the first buy of
 * the event cannot exceed the cap of starting cash. A position that drifts past
 * the cap because the stock rallied is fine — you just cannot add to it.
 */
async function withinConcentrationCap(
  tx: Conn, portfolioId: number, competitionId: number, tickIndex: number,
  stockId: number, newQty: number, cashAfter: number, capBps: number, thisPrice: number,
): Promise<boolean> {
  if (capBps <= 0 || capBps >= BPS) return true;

  const rows = await tx.execute<{ stock_id: string; qty: number; price: string }>(sql`
    SELECT h.stock_id, h.quantity AS qty,
           COALESCE(pt.price_paise, s.starting_price_paise) AS price
    FROM holdings h
    JOIN stocks s ON s.id = h.stock_id
    LEFT JOIN price_ticks pt
      ON pt.stock_id = h.stock_id AND pt.tick_index = ${tickIndex}
     AND pt.competition_id = ${competitionId}
    WHERE h.portfolio_id = ${portfolioId} AND h.quantity <> 0
  `);

  let othersValue = 0;
  for (const r of rows as unknown as Array<{ stock_id: string; qty: number; price: string }>) {
    if (Number(r.stock_id) === stockId) continue;
    othersValue += Number(r.qty) * Number(r.price);
  }

  const positionValue = newQty * thisPrice;
  const portfolioValue = cashAfter + othersValue + positionValue;
  if (portfolioValue <= 0) return false;
  // Absolute exposure: a 40% short is the same concentration of risk as a 40%
  // long. It is also what bounds the downside, since the circuit breaker caps
  // how far the stock can move against it.
  return (Math.abs(positionValue) * BPS) / portfolioValue <= capBps;
}

/** Rebuild the result of an order we have already executed, for an idempotent replay. */
async function replay(tx: Conn, prior: typeof orders.$inferSelect): Promise<OrderResult> {
  if (prior.status === "rejected") {
    const code = (prior.rejectCode ?? "MARKET_CLOSED") as RejectCode;
    return { ok: false, replayed: true, code, detail: prior.rejectDetail ?? REJECT_DETAIL[code] };
  }
  const trade = await tx.query.trades.findFirst({ where: eq(trades.orderId, prior.id) });
  const stock = await tx.query.stocks.findFirst({ where: eq(stocks.id, prior.stockId) });
  const pf = await tx.query.portfolios.findFirst({ where: eq(portfolios.teamId, prior.teamId) });
  return {
    ok: true, replayed: true, orderId: prior.id, tradeId: trade?.id ?? 0,
    side: prior.side, symbol: stock?.symbol ?? "", quantity: prior.quantity,
    fillPricePaise: trade?.fillPricePaise ?? 0, grossPaise: trade?.grossPaise ?? 0,
    brokeragePaise: trade?.brokeragePaise ?? 0, cashAfterPaise: pf?.cashPaise ?? 0,
    realisedPnlPaise: trade?.realisedPnlPaise ?? 0,
  };
}

/**
 * Place a market order.
 *
 * Everything below happens inside ONE transaction whose FIRST statement locks
 * the team's portfolio row. That ordering is deliberate and load-bearing:
 *
 *  - Race conditions (req 1): the lock serialises a team's own orders, so two
 *    rapid buys cannot both pass the cash check. Teams never block each other.
 *  - Server-side pricing (req 2): the price is read here, from the DB, at fill
 *    time. The caller never supplies one.
 *  - Idempotency (req 3): UNIQUE(team_id, idempotency_key). Because the lock is
 *    taken first, an in-flight duplicate blocks and then returns the original
 *    outcome rather than double-filling.
 *  - State checks (req 4): market state and halt status are re-read from the DB
 *    inside the transaction, never trusted from the client.
 *  - Rate limiting (req 6): counted inside the same transaction under the same
 *    lock, so it is exact rather than approximate.
 *  - Audit (req 7): the order row, the trade row and the audit row all commit
 *    together or not at all.
 */
export async function placeOrder(req: OrderRequest): Promise<OrderResult> {
  if (!Number.isInteger(req.quantity) || req.quantity < 1) {
    return { ok: false, replayed: false, code: "INVALID_QUANTITY", detail: REJECT_DETAIL.INVALID_QUANTITY };
  }

  return db.transaction(async (tx) => {
    /* 1. Lock the team's financial state. FIRST statement, always. */
    const pfRows = await tx.execute(sql`
      SELECT id, competition_id, cash_paise FROM portfolios WHERE team_id = ${req.teamId} FOR UPDATE
    `);
    const pf = (pfRows as unknown as Array<Record<string, unknown>>)[0];
    if (!pf) throw new Error("PORTFOLIO_NOT_FOUND");

    const portfolioId = Number(pf.id);
    const competitionId = Number(pf.competition_id);
    let cash = Number(pf.cash_paise);

    /* 2. Idempotency replay check, now that we hold the lock. */
    const prior = await tx.query.orders.findFirst({
      where: and(eq(orders.teamId, req.teamId), eq(orders.idempotencyKey, req.idempotencyKey)),
    });
    if (prior) return replay(tx, prior);

    const comp = await tx.query.competitions.findFirst({ where: eq(competitions.id, competitionId) });
    if (!comp) throw new Error("COMPETITION_NOT_FOUND");

    const stock = await tx.query.stocks.findFirst({
      where: and(eq(stocks.competitionId, competitionId), eq(stocks.symbol, req.symbol.toUpperCase())),
    });
    if (!stock) {
      return { ok: false, replayed: false, code: "UNKNOWN_SYMBOL", detail: REJECT_DETAIL.UNKNOWN_SYMBOL };
    }

    const reject = async (code: RejectCode): Promise<OrderResult> => {
      // Rejections are persisted too: they consume the idempotency key (so a
      // double-click shows one rejection, not two) and they are audit evidence.
      const [row] = await tx.insert(orders).values({
        competitionId, teamId: req.teamId, stockId: stock.id,
        idempotencyKey: req.idempotencyKey, side: req.side, quantity: req.quantity,
        status: "rejected", rejectCode: code, rejectDetail: REJECT_DETAIL[code],
        tickIndex: comp.currentTick,
      }).returning({ id: orders.id });
      await audit({ kind: "team", id: req.teamId, label: `team:${req.teamId}` }, "order.rejected", {
        competitionId, entityType: "order", entityId: row!.id,
        payload: { code, symbol: stock.symbol, side: req.side, quantity: req.quantity }, tx,
      });
      return { ok: false, replayed: false, code, detail: REJECT_DETAIL[code] };
    };

    /* 3. Server-side state checks. */
    if (comp.state !== "open") return reject("MARKET_CLOSED");
    if (stock.status === "halted") return reject("STOCK_HALTED");

    /* 4. Rate limit, exact because we hold the lock. */
    const rl = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM orders
      WHERE team_id = ${req.teamId} AND created_at > now() - interval '60 seconds'
    `);
    const recent = Number((rl as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    if (recent >= comp.orderRateLimitPerMin) return reject("RATE_LIMITED");

    /* 5. The server reads the price. The client never sends one.
     *
     * The stock row is locked here so orders on the same stock queue up and each
     * sees the slippage the one before it left. That is what makes being first
     * worth something. Teams never contend with each other on their portfolios,
     * only on a stock they are all trading, which is the honest place for it.
     */
    const stockRows = await tx.execute(sql`
      SELECT intra_tick_bps, intra_tick_at FROM stocks WHERE id = ${stock.id} FOR UPDATE
    `);
    const lockedStock = (stockRows as unknown as Array<Record<string, unknown>>)[0];
    const staleTick = Number(lockedStock?.intra_tick_at ?? -1) !== comp.currentTick;
    const intraBefore = staleTick ? 0 : Number(lockedStock?.intra_tick_bps ?? 0);

    const priceRow = await tx.query.priceTicks.findFirst({
      where: and(eq(priceTicks.stockId, stock.id), eq(priceTicks.tickIndex, comp.currentTick)),
    });
    const tickPrice = priceRow?.pricePaise ?? stock.startingPricePaise;
    if (!tickPrice || tickPrice <= 0) return reject("NO_PRICE");

    // Everyone in this tick trades off the same published price, shifted by
    // whatever has already been done to it inside the tick.
    const midPrice = Math.max(1, Math.round(tickPrice * (1 + intraBefore / BPS)));
    const fillPrice = applySpread(midPrice, req.side, comp.spreadBps);
    const gross = fillPrice * req.quantity;
    const brokerage = brokerageFor(gross, comp.brokerageBps);

    const existing = await tx.query.holdings.findFirst({
      where: and(eq(holdings.portfolioId, portfolioId), eq(holdings.stockId, stock.id)),
    });
    // Negative means the team is short this stock.
    const heldQty = existing?.quantity ?? 0;

    let realisedPnl = 0;
    let cashDelta = 0;
    let newQty = heldQty + (req.side === "buy" ? req.quantity : -req.quantity);
    let newAvg = existing?.avgCostPaise ?? 0;
    let newResidual = existing?.costResidual ?? 0;

    /*
     * Positions can be negative, so an order may do two things at once: a buy
     * while short both closes the short and opens a long, and a sell larger
     * than the holding both closes the long and opens a short. Each half is
     * handled explicitly rather than hoping one formula covers both.
     *
     * `avgCostPaise` is the average cost of a long or the average sale price of
     * a short; it is always positive and its meaning follows the sign of the
     * quantity.
     */
    const longHeld = Math.max(0, heldQty);
    const shortHeld = Math.max(0, -heldQty);

    if (req.side === "buy") {
      if (cash < gross + brokerage) return reject("INSUFFICIENT_CASH");

      const capOk = await withinConcentrationCap(
        tx, portfolioId, competitionId, comp.currentTick, stock.id,
        newQty, cash - gross - brokerage, comp.concentrationCapBps, midPrice,
      );
      if (!capOk) return reject("CONCENTRATION_CAP");

      // Whatever closes a short is realised at the difference between the price
      // it was sold at and the price paid to buy it back.
      const covered = Math.min(req.quantity, shortHeld);
      realisedPnl = (newAvg - fillPrice) * covered;
      cashDelta = -(gross + brokerage);

      if (newQty > 0 && heldQty < 0) {
        // Flipped from short to long: what remains is bought at this fill.
        newAvg = fillPrice;
        newResidual = 0;
      } else if (newQty > 0) {
        const merged = mergeAverageCost(longHeld, newAvg, newResidual, req.quantity, gross);
        newAvg = merged.avgCost;
        newResidual = merged.residual;
      } else if (newQty === 0) {
        newAvg = 0;
        newResidual = 0;
      }
      // Still short: a partial cover leaves the average sale price unchanged.
    } else {
      const canShort = comp.shortSellingEnabled;
      if (!canShort && req.quantity > longHeld) {
        return reject(longHeld === 0 && heldQty <= 0 ? "SHORTING_DISABLED" : "INSUFFICIENT_HOLDINGS");
      }

      if (newQty < 0) {
        const capOk = await withinConcentrationCap(
          tx, portfolioId, competitionId, comp.currentTick, stock.id,
          newQty, cash + gross - brokerage, comp.concentrationCapBps, midPrice,
        );
        if (!capOk) return reject("CONCENTRATION_CAP");
      }

      // Whatever closes a long is realised against its cost.
      const sold = Math.min(req.quantity, longHeld);
      realisedPnl = (fillPrice - newAvg) * sold;
      cashDelta = gross - brokerage;

      if (newQty < 0) {
        const openedShort = req.quantity - sold;
        const merged = mergeAverageCost(
          shortHeld, shortHeld > 0 ? newAvg : 0, shortHeld > 0 ? newResidual : 0,
          openedShort, openedShort * fillPrice,
        );
        newAvg = merged.avgCost;
        newResidual = merged.residual;
      } else if (newQty === 0) {
        newAvg = 0;
        newResidual = 0;
      }
      // Still long: a partial sale leaves the average cost unchanged.
    }

    /*
     * Order-flow impact counts ordinary buying and selling only. Anything that
     * opens or closes a short is flow-neutral, so shorting cannot drive the
     * price down and force more shorting.
     */
    const flowQty = req.side === "buy"
      ? Math.max(0, req.quantity - Math.min(req.quantity, shortHeld))
      : -Math.min(req.quantity, longHeld);

    cash += cashDelta;

    /* 6. Apply. Order, trade, holding, portfolio and audit all commit together. */
    const [orderRow] = await tx.insert(orders).values({
      competitionId, teamId: req.teamId, stockId: stock.id,
      idempotencyKey: req.idempotencyKey, side: req.side, quantity: req.quantity,
      status: "filled", tickIndex: comp.currentTick,
    }).returning({ id: orders.id });

    const [tradeRow] = await tx.insert(trades).values({
      orderId: orderRow!.id, competitionId, teamId: req.teamId, stockId: stock.id,
      side: req.side, quantity: req.quantity, midPricePaise: midPrice,
      fillPricePaise: fillPrice, grossPaise: gross, brokeragePaise: brokerage,
      cashDeltaPaise: cashDelta, avgCostAtFill: existing?.avgCostPaise ?? null,
      realisedPnlPaise: realisedPnl, flowQty, tickIndex: comp.currentTick,
    }).returning({ id: trades.id });

    if (existing) {
      await tx.update(holdings)
        .set({ quantity: newQty, avgCostPaise: newAvg, costResidual: newResidual, updatedAt: new Date() })
        .where(eq(holdings.id, existing.id));
    } else {
      await tx.insert(holdings).values({
        portfolioId, stockId: stock.id, quantity: newQty,
        avgCostPaise: newAvg, costResidual: newResidual,
      });
    }

    await tx.update(portfolios).set({
      cashPaise: cash,
      realisedPnlPaise: sql`${portfolios.realisedPnlPaise} + ${realisedPnl}`,
      brokeragePaidPaise: sql`${portfolios.brokeragePaidPaise} + ${brokerage}`,
      tradeCount: sql`${portfolios.tradeCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(portfolios.id, portfolioId));

    // Slippage follows the flow, so a short leaves no mark on the price.
    const slip = intraTickSlipBps(
      Math.abs(flowQty), req.side, stock.liquidity, comp.orderFlowEnabled,
    );
    if (slip !== 0 || staleTick) {
      await tx.update(stocks).set({
        intraTickBps: Math.max(-MAX_INTRA_TICK_BPS, Math.min(MAX_INTRA_TICK_BPS, intraBefore + slip)),
        intraTickAt: comp.currentTick,
      }).where(eq(stocks.id, stock.id));
    }

    await audit({ kind: "team", id: req.teamId, label: `team:${req.teamId}` }, "order.filled", {
      competitionId, entityType: "trade", entityId: tradeRow!.id,
      payload: {
        symbol: stock.symbol, side: req.side, quantity: req.quantity,
        tickPrice, intraTickBps: intraBefore, midPrice, fillPrice,
        gross, brokerage, cashAfter: cash, realisedPnl,
      },
      tx,
    });

    return {
      ok: true, replayed: false, orderId: orderRow!.id, tradeId: tradeRow!.id,
      side: req.side, symbol: stock.symbol, quantity: req.quantity,
      fillPricePaise: fillPrice, grossPaise: gross, brokeragePaise: brokerage,
      cashAfterPaise: cash, realisedPnlPaise: realisedPnl,
    };
  });
}
