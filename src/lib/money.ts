/**
 * All money in this app is an integer number of paise. There is no floating
 * point anywhere in the money path — see PLAN.md section 2.
 *
 * All rates are integer basis points: 0.2% = 20 bps, 40% = 4000 bps.
 */

export const BPS = 10_000;

/** ₹1 = 100 paise. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;

/**
 * Fill price rounds AGAINST the participant: buys round up, sells round down.
 * This closes the round-trip arbitrage where buying and selling at the same
 * mid price could mint fractional paise.
 */
export function applySpread(midPaise: number, side: "buy" | "sell", spreadBps: number): number {
  const half = spreadBps / 2;
  return side === "buy"
    ? Math.ceil(midPaise * (1 + half / BPS))
    : Math.floor(midPaise * (1 - half / BPS));
}

/** Brokerage always rounds up, and is never zero on a non-zero trade. */
export function brokerageFor(grossPaise: number, brokerageBps: number): number {
  if (grossPaise <= 0 || brokerageBps <= 0) return 0;
  return Math.max(1, Math.ceil((grossPaise * brokerageBps) / BPS));
}

/**
 * Weighted average cost with the integer-division remainder carried, so
 * avgCost * qty + residual always reconstructs total cost exactly.
 */
export function mergeAverageCost(
  oldQty: number, oldAvg: number, oldResidual: number,
  addQty: number, addTotalPaise: number,
): { avgCost: number; residual: number } {
  const totalCost = oldQty * oldAvg + oldResidual + addTotalPaise;
  const totalQty = oldQty + addQty;
  if (totalQty === 0) return { avgCost: 0, residual: 0 };
  return {
    avgCost: Math.floor(totalCost / totalQty),
    residual: totalCost % totalQty,
  };
}

/** Return in basis points relative to a starting value. */
export function returnBps(currentPaise: number, startingPaise: number): number {
  if (startingPaise === 0) return 0;
  return Math.round(((currentPaise - startingPaise) / startingPaise) * BPS);
}

/** Indian digit grouping: 1,23,45,678.90 */
export function formatPaise(paise: number, opts: { sign?: boolean; decimals?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;

  const s = String(whole);
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }

  const decimals = opts.decimals === false ? "" : "." + String(frac).padStart(2, "0");
  const prefix = negative ? "-" : opts.sign ? "+" : "";
  return prefix + grouped + decimals;
}

export const formatRupees = (paise: number, opts?: { sign?: boolean; decimals?: boolean }): string =>
  "₹" + formatPaise(paise, opts);

/** Basis points as a percentage string, e.g. 1234 -> "12.34%" */
export function formatBps(bps: number, opts: { sign?: boolean } = {}): string {
  const pct = bps / 100;
  const prefix = bps > 0 && opts.sign ? "+" : "";
  return prefix + pct.toFixed(2) + "%";
}

/** Compact form for tickers and mobile: ₹1.2L, ₹3.4Cr */
export function formatCompact(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  if (rupees >= 1e7) return `${sign}₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (rupees >= 1e5) return `${sign}₹${(rupees / 1e5).toFixed(2)}L`;
  if (rupees >= 1e3) return `${sign}₹${(rupees / 1e3).toFixed(1)}k`;
  return `${sign}₹${rupees.toFixed(0)}`;
}
