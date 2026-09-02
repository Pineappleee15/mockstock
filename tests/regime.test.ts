import { describe, it, expect } from "vitest";
import { regimeAt, regimeBlockTicks, intradayVolCurve, marketFactorBps, shockAt } from "../src/lib/regime";

describe("regimes", () => {
  it("holds steady inside a block and can change between blocks", () => {
    const block = regimeBlockTicks(5);
    const inside = regimeAt(1, 0, 5).key;
    for (let t = 0; t < block; t++) expect(regimeAt(1, t, 5).key).toBe(inside);

    const keys = new Set<string>();
    for (let b = 0; b < 60; b++) keys.add(regimeAt(1, b * block, 5).key);
    expect(keys.size).toBeGreaterThan(2);
  });

  it("visits calm and violent states over a session", () => {
    const block = regimeBlockTicks(5);
    const seen = new Set<string>();
    for (let b = 0; b < 200; b++) seen.add(regimeAt(9, b * block, 5).key);
    expect(seen.has("calm") || seen.has("normal")).toBe(true);
    expect(seen.has("turbulent") || seen.has("selloff") || seen.has("panic")).toBe(true);
  });

  it("is deterministic for a competition", () => {
    expect(regimeAt(4, 500, 5)).toEqual(regimeAt(4, 500, 5));
    const a = Array.from({ length: 40 }, (_, i) => regimeAt(4, i * 36, 5).key);
    const b = Array.from({ length: 40 }, (_, i) => regimeAt(5, i * 36, 5).key);
    expect(a).not.toEqual(b);
  });
});

describe("intraday volatility curve", () => {
  it("is busiest at the open, calmest in the middle", () => {
    const open = intradayVolCurve(0, 2160);
    const mid = intradayVolCurve(1080, 2160);
    const close = intradayVolCurve(2159, 2160);
    expect(open).toBeGreaterThan(mid);
    expect(close).toBeGreaterThan(mid);
    expect(mid).toBeCloseTo(1, 5);
  });

  it("never goes below one or silly high", () => {
    for (let t = 0; t <= 2160; t += 17) {
      const v = intradayVolCurve(t, 2160);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThan(2.2);
    }
  });

  it("copes with a zero-length session", () => {
    expect(intradayVolCurve(0, 0)).toBe(1);
  });
});

describe("market factor", () => {
  it("moves the whole market together and averages near zero", () => {
    let sum = 0;
    let moved = 0;
    for (let t = 1; t <= 2160; t++) {
      const f = marketFactorBps(3, t, 5, 2160, 10_000);
      sum += f.bps;
      if (f.bps !== 0) moved++;
    }
    expect(moved).toBeGreaterThan(1500);         // it is doing something
    expect(Math.abs(sum / 2160)).toBeLessThan(8); // without a runaway trend
  });

  it("scales with the configured strength", () => {
    const weak = Math.abs(marketFactorBps(3, 100, 5, 2160, 2_000).bps);
    const strong = Math.abs(marketFactorBps(3, 100, 5, 2160, 20_000).bps);
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("shocks", () => {
  it("fires rarely and lands within a sane range", () => {
    let hits = 0;
    for (let t = 1; t <= 20_000; t++) {
      const s = shockAt(11, t, 28, 15);
      if (!s) continue;
      hits++;
      expect(s.stockIndex).toBeGreaterThanOrEqual(0);
      expect(s.stockIndex).toBeLessThan(28);
      expect(Math.abs(s.deltaBps)).toBeGreaterThanOrEqual(150);
      expect(Math.abs(s.deltaBps)).toBeLessThanOrEqual(600);
    }
    // 15 bps a tick is 0.15%, so roughly 30 in 20,000.
    expect(hits).toBeGreaterThan(5);
    expect(hits).toBeLessThan(120);
  });

  it("never fires when disabled", () => {
    for (let t = 1; t <= 5000; t++) expect(shockAt(11, t, 28, 0)).toBeNull();
  });
});
