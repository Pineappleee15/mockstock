import { describe, it, expect } from "vitest";
import { ticksDue, MAX_CATCHUP_TICKS } from "../src/lib/tick-clock";

const MAX = MAX_CATCHUP_TICKS;
const now = 1_700_000_000_000;
const ago = (seconds: number) => new Date(now - seconds * 1000);

describe("catch-up planning", () => {
  it("does nothing before an interval has elapsed", () => {
    expect(ticksDue(ago(0), now, 5).due).toBe(0);
    expect(ticksDue(ago(4), now, 5).due).toBe(0);
  });

  it("ticks once per elapsed interval", () => {
    expect(ticksDue(ago(5), now, 5).due).toBe(1);
    expect(ticksDue(ago(50), now, 5).due).toBe(10);
    expect(ticksDue(ago(60), now, 60).due).toBe(1);
  });

  it("never floors up to 1 — that would make the poll rate the tick rate", () => {
    // The bug this replaced: prices moved 5x too fast and realised volatility
    // was 5x the configured figure, because sigma is scaled by the configured
    // interval rather than by how often we actually ticked.
    expect(ticksDue(ago(1), now, 5).due).toBe(0);
    expect(ticksDue(ago(1), now, 30).due).toBe(0);
  });

  it("replays a short outage in full", () => {
    // A deploy or a crash: worth replaying so the chart has no gap.
    const plan = ticksDue(ago(120), now, 5);
    expect(plan.due).toBe(24);
    expect(plan.skipped).toBe(0);
  });

  it("replays a ten-minute outage in full, since it is under the cap", () => {
    const plan = ticksDue(ago(600), now, 5); // 120 ticks
    expect(plan.due).toBe(120);
    expect(plan.skipped).toBe(0);
  });

  it("caps an outage longer than the replay window", () => {
    const plan = ticksDue(ago(1800), now, 5); // 360 ticks wanted
    expect(plan.due).toBe(MAX);
    expect(plan.skipped).toBe(360 - MAX);
  });

  it("skips the gap when a market is left open for hours or days", () => {
    // Render's free tier sleeps after 15 idle minutes. Without the skip, every
    // poll would replay the cap and never catch up, churning through days of
    // invented price history for a market nobody could trade in.
    const twoDays = ticksDue(ago(2 * 24 * 3600), now, 5);
    expect(twoDays.due).toBe(MAX);
    expect(twoDays.skipped).toBe(2 * 24 * 3600 / 5 - MAX);
    expect(twoDays.gapSeconds).toBe(172800);
  });

  it("handles a null last-tick as a fresh start", () => {
    expect(ticksDue(null, now, 5)).toEqual({ due: 0, skipped: 0, gapSeconds: 0 });
  });

  it("never returns negative work if the clock goes backwards", () => {
    const plan = ticksDue(new Date(now + 60_000), now, 5);
    expect(plan.due).toBe(0);
    expect(plan.skipped).toBe(0);
  });
});
