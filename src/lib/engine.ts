import { BPS } from "./money";
import { gaussian } from "./rng";
import type { EngineConfig, EngineStock, StockState, TickInput, TickOutput } from "./engine-types";

export type { EngineConfig, EngineStock, StockState, TickInput, TickOutput };

/**
 * The price engine. See PLAN.md section 3.
 *
 * Each stock carries two prices:
 *   anchor — "fair value". Slow seeded random walk, moved permanently by news,
 *            admin overrides, and the permanent share of order-flow impact.
 *   price  — what teams trade at. Pushed away from the anchor by order flow
 *            (the `gap`), and pulled back toward it over gapHalflifeSeconds.
 *
 * The pullback is what stops the event breaking in its first five minutes.
 * Every team starts at 100% cash and must buy something, so net flow at the
 * open is structurally, massively positive. Without a pullback every stock
 * pumps 40-60% in the opening rush and then there is nothing left to trade.
 */

/**
 * Fraction of the gap that survives one tick, in bps.
 *
 * Math.pow is used here and nowhere else in the engine. It is called once per
 * config (not per tick, not per stock) and its result is immediately rounded to
 * an integer bps, so a last-ULP difference between engines cannot change any
 * price. Everything downstream is integer or IEEE-exact.
 */
export function pullbackBps(cfg: EngineConfig): number {
  if (cfg.gapHalflifeSeconds <= 0) return 0;
  const factor = Math.pow(0.5, cfg.tickIntervalSeconds / cfg.gapHalflifeSeconds);
  return Math.round(factor * BPS);
}

/**
 * Square-root market impact: impact ∝ sqrt(volume). This is the standard
 * empirical law, and practically it means one rich team cannot move a stock
 * 300% in a tick while a coordinated 200-team rush still can.
 */
export function impactBpsFor(netQty: number, stock: EngineStock, cfg: EngineConfig): number {
  if (!cfg.orderFlowEnabled || netQty === 0) return 0;
  // Liquidity can be scaled globally: the per-stock figures are calibrated for
  // a given crowd size, and a small room needs thinner books to feel anything.
  const liquidity = Math.max(1, stock.liquidity * ((cfg.liquidityMultiplierBps ?? 10_000) / BPS));
  const magnitude = Math.sqrt(Math.abs(netQty) / liquidity);
  const raw = cfg.impactCoefficientBps * magnitude * Math.sign(netQty);
  const clamped = Math.max(-cfg.maxImpactBpsPerTick, Math.min(cfg.maxImpactBpsPerTick, raw));
  return Math.round(clamped);
}

/** Effective circuit limit for a stock (per-stock override, else competition default). */
export function circuitLimitFor(stock: EngineStock, cfg: EngineConfig): number {
  return stock.circuitLimitBps ?? cfg.circuitLimitBps;
}

/** True if `price` is outside the stock's circuit band around its session open. */
export function breachesCircuit(price: number, stock: EngineStock, cfg: EngineConfig): boolean {
  const open = stock.sessionOpenPaise;
  if (!open || open <= 0) return false;
  const limit = circuitLimitFor(stock, cfg);
  if (limit <= 0) return false;
  const moveBps = Math.abs(((price - open) / open) * BPS);
  return moveBps > limit;
}

/** Clamp a price to the edge of the circuit band. */
function clampToCircuit(price: number, stock: EngineStock, cfg: EngineConfig): number {
  const open = stock.sessionOpenPaise;
  if (!open || open <= 0) return price;
  const limit = circuitLimitFor(stock, cfg);
  if (limit <= 0) return price;
  const upper = Math.floor(open * (1 + limit / BPS));
  const lower = Math.ceil(open * (1 - limit / BPS));
  return Math.max(lower, Math.min(upper, price));
}

/**
 * Advance one stock by one tick. Pure: same inputs always produce the same
 * output, on any machine. All persistence happens in ticker.ts.
 */
export function computeTick(input: TickInput, cfg: EngineConfig, pullback: number): TickOutput {
  const { state, stock, tickIndex, netQty, newsDeltaBps } = input;

  // An admin override wins over everything and re-bases the anchor, so the
  // walk continues from the forced price rather than springing back.
  if (input.overridePaise != null && input.overridePaise > 0) {
    return {
      state: { pricePaise: input.overridePaise, anchorPaise: input.overridePaise, gapBps: 0 },
      netQty: 0,
      halted: stock.halted,
      breachedCircuit: false,
      impactBps: 0,
    };
  }

  // A halted stock is frozen flat: no walk, no news, no impact. Order flow that
  // accumulated during the halt is discarded rather than applied on resume,
  // because releasing it all at once fires a cannon at un-halt.
  if (stock.halted) {
    return { state: { ...state }, netQty: 0, halted: true, breachedCircuit: false, impactBps: 0 };
  }

  const dtMinutes = cfg.tickIntervalSeconds / 60;
  // Regime turbulence lifts every stock's own volatility as well as the market
  // factor, so a panic is felt twice: broadly and individually.
  const volMult = (cfg.volatilityMultiplierBps / BPS) * (cfg.regimeVolMultiplier ?? 1);

  // volatilityBps and driftBps are quoted PER MINUTE, so changing the tick
  // interval does not change how dramatic the event feels.
  const sigma = (stock.volatilityBps / BPS) * volMult * Math.sqrt(dtMinutes);
  const drift = (stock.driftBps / BPS) * dtMinutes;
  const z = gaussian(stock.seed, tickIndex);

  const impact = impactBpsFor(netQty, stock, cfg);
  const permanent = Math.round((impact * cfg.permanentImpactBps) / BPS);
  const transient = impact - permanent;

  // Anchor: fundamentals, the shared market move scaled by this stock's beta,
  // news, an unexplained shock if it drew one, and the permanent share of order
  // flow. The market term is what makes stocks fall and recover together.
  const market = ((input.marketBps ?? 0) * stock.beta) / BPS;
  const shock = (input.shockBps ?? 0) / BPS;
  const anchorGrowth = 1 + drift + sigma * z + market + shock + newsDeltaBps / BPS + permanent / BPS;
  const anchorNext = Math.max(1, Math.round(state.anchorPaise * anchorGrowth));

  // Gap: order-flow displacement, decaying back toward fair value.
  const gapNext = Math.round((state.gapBps * pullback) / BPS) + transient;

  const rawPrice = Math.round(anchorNext * (1 + gapNext / BPS));
  const priceNext = Math.max(1, rawPrice);

  const breached = breachesCircuit(priceNext, stock, cfg);
  const finalPrice = breached ? clampToCircuit(priceNext, stock, cfg) : priceNext;

  return {
    state: { pricePaise: finalPrice, anchorPaise: anchorNext, gapBps: gapNext },
    netQty,
    halted: breached,
    breachedCircuit: breached,
    impactBps: impact,
  };
}

/**
 * Per-tick news increments across a decay window, easing out so the headline
 * hits hard and then settles. Increments sum to exactly `totalBps` — the last
 * one absorbs the rounding residual, so a +500bps event moves the anchor by
 * exactly 500bps and never 499 or 501.
 */
export function newsSchedule(totalBps: number, ticks: number): number[] {
  if (ticks <= 1) return [totalBps];
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < ticks; i++) {
    // Ease-out: 1 - (i/n)^2, front-loaded.
    const t = i / ticks;
    const w = 1 - t * t;
    weights.push(w);
    sum += w;
  }
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < ticks - 1; i++) {
    const share = Math.round((totalBps * weights[i]!) / sum);
    out.push(share);
    allocated += share;
  }
  out.push(totalBps - allocated);
  return out;
}
