import { and, eq, sql } from "drizzle-orm";
import {
  db, competitions, stocks, portfolios, holdings, orders, trades, priceTicks, type Conn,
} from "@/db";
import { applySpread, brokerageFor, mergeAverageCost, BPS } from "./money";
import { audit } from "./audit";

export type RejectCode =
  | "MARKET_CLOSED" | "STOCK_HALTED" | "UNKNOWN_SYMBOL" | "INVALID_QUANTITY"
  | "INSUFFICIENT_CASH" | "INSUFFICIENT_HOLDINGS" | "CONCENTRATION_CAP"
  | "RATE_LIMITED" | "NO_PRICE";

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

export const REJECT_DETAIL: Record<RejectCode, string> = {
  MARKET_CLOSED: "The market is not open for trading right now.",
  STOCK_HALTED: "Trading in this stock is halted.",
  UNKNOWN_SYMBOL: "No such stock in this competition.",
  INVALID_QUANTITY: "Quantity must be a whole number of at least 1.",
  INSUFFICIENT_CASH: "Not enough cash for this order including fees.",
  INSUFFICIENT_HOLDINGS: "You do not hold that many shares.",
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
    WHERE h.portfolio_id = ${portfolioId} AND h.quantity > 0
  `);

  let othersValue = 0;
  for (const r of rows as unknown as Array<{ stock_id: string; qty: number; price: string }>) {
    if (Number(r.stock_id) === stockId) continue;
    othersValue += Number(r.qty) * Number(r.price);
  }

  const positionValue = newQty * thisPrice;
  const portfolioValue = cashAfter + othersValue + positionValue;
  if (portfolioValue <= 0) return true;
  return (positionValue * BPS) / portfolioValue <= capBps;
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

    /* 5. The server reads the price. The client never sends one. */
    const priceRow = await tx.query.priceTicks.findFirst({
      where: and(eq(priceTicks.stockId, stock.id), eq(priceTicks.tickIndex, comp.currentTick)),
    });
    const midPrice = priceRow?.pricePaise ?? stock.startingPricePaise;
    if (!midPrice || midPrice <= 0) return reject("NO_PRICE");

    const fillPrice = applySpread(midPrice, req.side, comp.spreadBps);
    const gross = fillPrice * req.quantity;
    const brokerage = brokerageFor(gross, comp.brokerageBps);

    const existing = await tx.query.holdings.findFirst({
      where: and(eq(holdings.portfolioId, portfolioId), eq(holdings.stockId, stock.id)),
    });
    const heldQty = existing?.quantity ?? 0;

    let realisedPnl = 0;
    let cashDelta = 0;
    let newQty = heldQty;
    let newAvg = existing?.avgCostPaise ?? 0;
    let newResidual = existing?.costResidual ?? 0;

    if (req.side === "buy") {
      if (cash < gross + brokerage) return reject("INSUFFICIENT_CASH");
      const capOk = await withinConcentrationCap(
        tx, portfolioId, competitionId, comp.currentTick, stock.id,
        heldQty + req.quantity, cash - gross - brokerage, comp.concentrationCapBps, midPrice,
      );
      if (!capOk) return reject("CONCENTRATION_CAP");

      cashDelta = -(gross + brokerage);
      newQty = heldQty + req.quantity;
      const merged = mergeAverageCost(heldQty, newAvg, newResidual, req.quantity, gross);
      newAvg = merged.avgCost;
      newResidual = merged.residual;
    } else {
      if (heldQty < req.quantity) return reject("INSUFFICIENT_HOLDINGS");
      realisedPnl = (fillPrice - newAvg) * req.quantity;
      cashDelta = gross - brokerage;
      newQty = heldQty - req.quantity;
      if (newQty === 0) newResidual = 0;
    }

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
      cashDeltaPaise: cashDelta, avgCostAtFill: req.side === "sell" ? newAvg : null,
      realisedPnlPaise: realisedPnl, tickIndex: comp.currentTick,
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

    await audit({ kind: "team", id: req.teamId, label: `team:${req.teamId}` }, "order.filled", {
      competitionId, entityType: "trade", entityId: tradeRow!.id,
      payload: {
        symbol: stock.symbol, side: req.side, quantity: req.quantity,
        midPrice, fillPrice, gross, brokerage, cashAfter: cash, realisedPnl,
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
