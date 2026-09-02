import { gaussian, uniform, hash32 } from "./rng";

/**
 * Market regimes: the thing that makes a session feel like an event rather
 * than three hours of stationary noise.
 *
 * Two problems this solves.
 *
 * First, every stock used to move independently, so the market never had a
 * mood. Nothing ever fell together and nothing ever recovered together, which
 * is most of the drama in a real market. There is now a common market factor
 * each tick, and each stock's exposure to it is its beta — the same beta shown
 * on its fundamentals card, so that number is literally true rather than
 * decorative.
 *
 * Second, the session had no arc. Regimes now change every few minutes between
 * calm, rallying, turbulent and outright panic, and volatility is higher around
 * the open and into the close, the way real sessions behave.
 *
 * Pure and free of transcendental functions, so it is deterministic and
 * testable without a database or a clock.
 */

export type RegimeKey = "calm" | "normal" | "rally" | "turbulent" | "selloff" | "panic";

export interface Regime {
  key: RegimeKey;
  label: string;
  /** Multiplies both the market factor and every stock's own volatility. */
  volMultiplier: number;
  /** Market-wide drift while this regime holds, in bps per minute. */
  driftBpsPerMin: number;
}

/** Weighted so calm and normal dominate and panic is a genuine event. */
const REGIMES: Array<Regime & { weight: number }> = [
  { key: "calm",      label: "Quiet",       volMultiplier: 0.6, driftBpsPerMin: 0,   weight: 20 },
  { key: "normal",    label: "Steady",      volMultiplier: 1.0, driftBpsPerMin: 0,   weight: 32 },
  { key: "rally",     label: "Rallying",    volMultiplier: 1.3, driftBpsPerMin: 12,  weight: 18 },
  { key: "turbulent", label: "Choppy",      volMultiplier: 1.7, driftBpsPerMin: 0,   weight: 16 },
  { key: "selloff",   label: "Selling off", volMultiplier: 1.9, driftBpsPerMin: -16, weight: 10 },
  { key: "panic",     label: "Panic",       volMultiplier: 2.5, driftBpsPerMin: -30, weight: 4 },
];

const TOTAL_WEIGHT = REGIMES.reduce((a, r) => a + r.weight, 0);
const REGIME_STREAM = 7001;
const FACTOR_STREAM = 7002;
const SHOCK_STREAM = 7003;

/** How long a regime holds, in ticks. Roughly three minutes. */
export function regimeBlockTicks(tickIntervalSeconds: number): number {
  return Math.max(6, Math.round(180 / Math.max(1, tickIntervalSeconds)));
}

/** Which regime is in force at a given tick. Stable within its block. */
export function regimeAt(seed: number, tick: number, tickIntervalSeconds: number): Regime {
  const block = Math.floor(Math.max(0, tick) / regimeBlockTicks(tickIntervalSeconds));
  const pick = uniform(hash32(seed, block, REGIME_STREAM), block, REGIME_STREAM) * TOTAL_WEIGHT;

  let acc = 0;
  for (const r of REGIMES) {
    acc += r.weight;
    if (pick < acc) return r;
  }
  return REGIMES[1]!;
}

/**
 * Intraday volatility curve: busy at the open, quiet through the middle, busy
 * again into the close. Piecewise linear rather than exponential so it stays
 * bit-identical everywhere.
 */
export function intradayVolCurve(tick: number, sessionTicks: number): number {
  if (sessionTicks <= 0) return 1;
  const t = Math.max(0, Math.min(1, tick / sessionTicks));
  const openBoost = Math.max(0, 1 - t / 0.12);
  const closeBoost = Math.max(0, (t - 0.85) / 0.15);
  return 1 + 0.6 * openBoost + 0.5 * closeBoost;
}

/** Base market volatility, bps per minute, before regime and curve. */
const BASE_MARKET_VOL_BPS = 26;

/**
 * The common move every stock shares this tick, in basis points.
 * A stock feels this multiplied by its beta.
 */
export function marketFactorBps(
  seed: number, tick: number, tickIntervalSeconds: number,
  sessionTicks: number, strengthBps: number,
): { bps: number; regime: Regime; curve: number } {
  const regime = regimeAt(seed, tick, tickIntervalSeconds);
  const curve = intradayVolCurve(tick, sessionTicks);
  const dtMin = tickIntervalSeconds / 60;

  const sigma = BASE_MARKET_VOL_BPS * regime.volMultiplier * curve * Math.sqrt(dtMin);
  const drift = regime.driftBpsPerMin * dtMin;
  const z = gaussian(hash32(seed, tick, FACTOR_STREAM), tick, FACTOR_STREAM);

  const raw = (drift + sigma * z) * (strengthBps / 10_000);
  return { bps: Math.round(raw), regime, curve };
}

/**
 * An unexplained jolt in a single stock. No headline, no reason given — the
 * kind of thing that makes a room look up and ask what just happened.
 * Returns null on most ticks.
 */
export function shockAt(
  seed: number, tick: number, stockCount: number, chanceBps: number,
): { stockIndex: number; deltaBps: number } | null {
  if (stockCount <= 0 || chanceBps <= 0) return null;
  const roll = uniform(hash32(seed, tick, SHOCK_STREAM), tick, SHOCK_STREAM);
  if (roll * 10_000 >= chanceBps) return null;

  const which = Math.floor(uniform(hash32(seed, tick, SHOCK_STREAM + 1), tick, SHOCK_STREAM + 1) * stockCount);
  const size = uniform(hash32(seed, tick, SHOCK_STREAM + 2), tick, SHOCK_STREAM + 2);
  const dir = uniform(hash32(seed, tick, SHOCK_STREAM + 3), tick, SHOCK_STREAM + 3) < 0.45 ? -1 : 1;

  // 1.5% to 6%, skewed towards the smaller end.
  const magnitude = 150 + Math.round(size * size * 450);
  return { stockIndex: Math.min(stockCount - 1, which), deltaBps: dir * magnitude };
}
