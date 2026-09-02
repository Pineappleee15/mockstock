/**
 * The market index. Its own module with no database import, so it stays a pure
 * function that can be tested without a connection.
 */

/** Where the index starts at the session open. */
export const INDEX_BASE = 1000;

export interface MarketIndex {
  /** Index level, base 1000 at the session open. */
  value: number;
  /** Move from the session open, in basis points. */
  returnBps: number;
  /** Stocks included. Halted ones count; they are simply flat. */
  constituents: number;
}

/**
 * Equal-weighted index of every stock, measured from the session open.
 *
 * Equal weighting rather than market cap, because market cap here is a
 * generated fundamental rather than a real float — weighting by an invented
 * number would make "beating the market" depend on which stocks happened to be
 * assigned a big one.
 *
 * This does NOT change the leaderboard order. The market return is the same for
 * every team, so ranking on return and ranking on alpha are identical
 * orderings. The index exists to make the number mean something.
 */
export function marketIndex(rows: Array<{ changeBps: number }>): MarketIndex {
  if (rows.length === 0) return { value: INDEX_BASE, returnBps: 0, constituents: 0 };
  const mean = rows.reduce((sum, r) => sum + r.changeBps, 0) / rows.length;
  return {
    value: Math.round(INDEX_BASE * (1 + mean / 10_000) * 100) / 100,
    returnBps: Math.round(mean),
    constituents: rows.length,
  };
}
