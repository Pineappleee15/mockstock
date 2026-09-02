/**
 * Deciding how many ticks are owed. Deliberately in its own module with no
 * database import, so it stays a pure function that can be tested without a
 * connection or a real clock.
 */

/**
 * Cap on how much history the ticker will replay after an interruption.
 * 240 ticks is 20 minutes at the default 5-second interval.
 */
export const MAX_CATCHUP_TICKS = 240;

export interface CatchUpPlan {
  /** Ticks to replay right now. */
  due: number;
  /** Ticks deliberately discarded because the gap was too long to be real. */
  skipped: number;
  gapSeconds: number;
}

/**
 * Replay exists to cover short interruptions — a deploy, a restart, a slow
 * cycle — so the chart has no gap and no news event is lost.
 *
 * It is NOT meant to manufacture price history for a market that was left open
 * and abandoned. On a free host that sleeps after 15 idle minutes, a market
 * left open overnight would otherwise owe tens of thousands of ticks, and since
 * each poll can only replay the cap, it would never catch up: every cycle would
 * churn out another 240 ticks of prices for a market nobody could trade in.
 * So anything past the cap is skipped, and the caller moves the clock forward.
 */
export function ticksDue(
  lastTickAt: Date | null, now: number, tickIntervalSeconds: number,
): CatchUpPlan {
  const intervalMs = Math.max(1, tickIntervalSeconds) * 1000;
  const last = lastTickAt?.getTime() ?? now;
  const gapMs = Math.max(0, now - last);
  const elapsed = Math.floor(gapMs / intervalMs);

  return {
    due: Math.min(MAX_CATCHUP_TICKS, elapsed),
    skipped: Math.max(0, elapsed - MAX_CATCHUP_TICKS),
    gapSeconds: Math.round(gapMs / 1000),
  };
}
