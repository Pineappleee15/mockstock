import { gaussian, uniform, hash32 } from "./rng";
import { BPS } from "./money";

/**
 * Giving stocks something to analyse.
 *
 * The problem this solves: with drift at zero for every stock, prices are pure
 * noise, so any "fundamentals" would be decoration attached to randomness.
 * Teams would study them, learn nothing, and correctly conclude that research
 * is pointless.
 *
 * So the hidden parameter comes first. Each stock is assigned a drift, derived
 * from the competition id and the symbol, which means it is stable within an
 * event and different in the next one. Everything a participant can read —
 * price history, the fundamentals card, the analyst view — is a HONEST
 * function of that drift. A team that reads them well genuinely does better.
 *
 * Signal is deliberately comparable to noise, not larger than it. Over a
 * three-hour event drift moves a stock roughly as much as randomness does, so
 * good analysis beats coin-flipping without making the event a solved puzzle.
 */

/** Streams, so one derived figure never correlates with another by accident. */
const STREAM = {
  drift: 101,
  history: 202,
  quality: 303,
  analyst: 404,
} as const;

/**
 * How hard a stock responds to a market-wide move.
 *
 * Exported because the price engine uses exactly this value, so the beta printed
 * on the fundamentals card is the real one rather than a plausible-looking
 * decoration. A high-beta stock genuinely swings harder when the market moves.
 */
export function betaFor(competitionId: number, symbol: string, volatilityBps: number): number {
  const seed = hash32(competitionId, symbolSeed(symbol), STREAM.quality);
  const jitter = (uniform(seed, 5, STREAM.quality) - 0.5) * 2 * 0.16;
  return Math.round(Math.max(0.35, volatilityBps / 55 + jitter) * 100) / 100;
}

/** Per-minute drift for a stock in a given competition. Roughly -5..+5 bps. */
export function driftFor(competitionId: number, symbol: string, spreadBps = 5): number {
  const seed = hash32(competitionId, symbolSeed(symbol), STREAM.drift);
  // Irwin-Hall gaussian truncated at 6 sigma, scaled and clamped so no stock
  // is a guaranteed rocket.
  const z = gaussian(seed, 0, STREAM.drift);
  return Math.max(-spreadBps, Math.min(spreadBps, Math.round((z / 2.2) * spreadBps)));
}

function symbolSeed(symbol: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** How volatile a day looks compared with a minute, and how far drift carries. */
const DAILY_VOL_FACTOR = 3;
const DAILY_DRIFT_FACTOR = 6;

/**
 * Plausible price history ending exactly at the opening price.
 *
 * Generated with the same drift as the live path, so a stock that is going to
 * trend up has visibly been trending up. That is the whole point: the chart is
 * evidence, not decoration.
 */
export function priceHistory(
  competitionId: number, symbol: string,
  openPricePaise: number, volatilityBps: number, driftBps: number,
  days = 60,
): number[] {
  const seed = hash32(competitionId, symbolSeed(symbol), STREAM.history);
  const sigma = (volatilityBps * DAILY_VOL_FACTOR) / BPS;
  const mu = (driftBps * DAILY_DRIFT_FACTOR) / BPS;

  const path: number[] = [1];
  for (let d = 1; d <= days; d++) {
    const z = gaussian(seed, d, STREAM.history);
    path.push(Math.max(0.05, path[d - 1]! * (1 + mu + sigma * z)));
  }

  // Rescale so the series lands exactly on today's opening price.
  const last = path[path.length - 1]!;
  return path.map((v) => Math.max(1, Math.round((v / last) * openPricePaise)));
}

/* ────────────────────────  the fundamentals card  ──────────────────────── */

export interface Fundamentals {
  marketCapCr: number;
  peRatio: number;
  revenueGrowthPct: number;
  profitMarginPct: number;
  debtToEquity: number;
  beta: number;
  high52Paise: number;
  low52Paise: number;
  analystTargetPaise: number;
  analystRating: "Strong buy" | "Buy" | "Hold" | "Reduce" | "Sell";
}

const RATINGS = ["Sell", "Reduce", "Hold", "Buy", "Strong buy"] as const;

/**
 * Spread of the analyst's error.
 *
 * A rating is a one-glance answer, so if it were nearly as good as reading the
 * accounts nobody would read the accounts. Measured over 400 simulated
 * sessions, following the analysts against doing the work:
 *
 *   0.055   6.7% vs 9.0%   three quarters of the reward for none of the effort
 *   0.12    4.9% vs 9.0%
 *   0.18    3.1% vs 9.0%   a real signal, worth about a third
 *   0.26    2.0% vs 9.0%   barely better than guessing
 *
 * 0.18 keeps the analyst worth listening to without making research optional.
 * Override with BCX_ANALYST_NOISE when re-tuning.
 */
export const ANALYST_NOISE = Number(process.env.BCX_ANALYST_NOISE ?? 0.18);

/**
 * Derive a fundamentals card from the stock's real hidden parameters.
 *
 * Everything here is a genuine function of drift, volatility or liquidity, with
 * a little noise so it reads as a research note rather than a lookup table:
 *
 *   drift      -> revenue growth, profit margin, P/E, analyst target and rating
 *   volatility -> beta, and the width of the 52-week range
 *   liquidity  -> market cap
 *
 * The analyst view is drift plus a wider noise term, so it is right more often
 * than not and wrong often enough to be worth a second opinion.
 */
export function fundamentalsFor(
  competitionId: number, symbol: string,
  pricePaise: number, volatilityBps: number, driftBps: number, liquidity: number,
  history: number[],
  /** Must match the spread the drift was drawn from, or the card cannot tell a
   *  very good company from a merely good one — every strong stock would clamp
   *  to the same figures. */
  driftSpreadBps = 5,
): Fundamentals {
  const seed = hash32(competitionId, symbolSeed(symbol), STREAM.quality);
  const noise = (i: number, spread: number) => (uniform(seed, i, STREAM.quality) - 0.5) * 2 * spread;

  // Drift normalised to roughly -1..+1 — "how good is this company".
  const q = Math.max(-1, Math.min(1, driftBps / Math.max(1, driftSpreadBps)));

  const revenueGrowthPct = round1(6 + q * 16 + noise(1, 3));
  const profitMarginPct = round1(11 + q * 7 + noise(2, 2.5));
  // Better companies are more expensive, which is what makes it a judgement
  // call rather than a lookup: growth is priced in, but imperfectly.
  const peRatio = round1(22 + q * 14 + noise(3, 5));
  const debtToEquity = Math.max(0.05, round2(0.75 - q * 0.45 + noise(4, 0.18)));
  const beta = betaFor(competitionId, symbol, volatilityBps);

  // Market cap is anchored to the share price but scaled by a seeded size
  // factor, so an expensive share is not automatically a huge company. Tuned to
  // land in the tens of thousands to low lakhs of crore, which is where real
  // Indian large and mid caps sit.
  const sizeFactor = 0.5 + uniform(seed, 6, STREAM.quality) * 3.5;
  const marketCapCr =
    Math.round(((pricePaise / 100) * 60 * sizeFactor) / 100) * 100;

  const lo = Math.min(...history);
  const hi = Math.max(...history);
  const pad = Math.round((hi - lo) * 0.06) + 1;

  /*
   * Analyst target: drift seen through a much cloudier lens than the accounts.
   *
   * Deliberately weak. A rating is a one-glance answer, so if it were nearly as
   * good as reading the accounts nobody would read the accounts — which is the
   * whole point of the exercise. Tuned so that following the analysts beats
   * guessing but is a fraction of what the numbers pay.
   */
  const analystErr = gaussian(seed, 7, STREAM.analyst) * ANALYST_NOISE;
  const analystTargetPaise = Math.max(1, Math.round(pricePaise * (1 + q * 0.14 + analystErr)));
  const impliedUpside = (analystTargetPaise - pricePaise) / pricePaise;
  const ratingIndex = Math.max(0, Math.min(4, Math.round(2 + impliedUpside / 0.05)));

  return {
    marketCapCr,
    peRatio,
    revenueGrowthPct,
    profitMarginPct,
    debtToEquity,
    beta,
    high52Paise: hi + pad,
    low52Paise: Math.max(1, lo - pad),
    analystTargetPaise,
    analystRating: RATINGS[ratingIndex]!,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
