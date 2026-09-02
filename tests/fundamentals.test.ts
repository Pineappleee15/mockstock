import { describe, it, expect } from "vitest";
import { driftFor, priceHistory, fundamentalsFor } from "../src/lib/fundamentals";

const SYMBOLS = Array.from({ length: 28 }, (_, i) => `STK${i}`);

/** Pearson correlation, for asking "is this actually a signal?" */
function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return num / Math.sqrt(dx * dy || 1);
}

function universe(compId: number) {
  return SYMBOLS.map((symbol, i) => {
    const price = 20000 + i * 9000;
    const vol = 35 + (i % 8) * 10;
    const drift = driftFor(compId, symbol);
    const history = priceHistory(compId, symbol, price, vol, drift);
    return {
      symbol, price, vol, drift, history,
      f: fundamentalsFor(compId, symbol, "IT", price, vol, drift, 1500, history),
    };
  });
}

describe("drift assignment", () => {
  it("spreads stocks across positive and negative", () => {
    const drifts = universe(1).map((s) => s.drift);
    expect(drifts.some((d) => d > 1)).toBe(true);
    expect(drifts.some((d) => d < -1)).toBe(true);
    expect(Math.max(...drifts.map(Math.abs))).toBeLessThanOrEqual(5);
  });

  it("is stable within a competition and different in the next", () => {
    expect(driftFor(1, "TCS")).toBe(driftFor(1, "TCS"));
    const a = universe(1).map((s) => s.drift);
    const b = universe(2).map((s) => s.drift);
    expect(a).not.toEqual(b);
  });

  it("regenerates across many competitions without collapsing to one value", () => {
    const spread = new Set<number>();
    for (let c = 1; c <= 40; c++) spread.add(driftFor(c, "RELIANCE"));
    expect(spread.size).toBeGreaterThan(4);
  });
});

describe("history is evidence, not decoration", () => {
  it("ends exactly on the opening price", () => {
    for (const s of universe(3)) {
      expect(s.history.at(-1)).toBe(s.price);
    }
  });

  it("trends in the direction of the hidden drift", () => {
    const u = universe(5);
    const totalReturn = u.map((s) => (s.history.at(-1)! - s.history[0]!) / s.history[0]!);
    // Past trend must genuinely carry information about drift, or chart-reading
    // teaches teams the wrong lesson.
    expect(corr(u.map((s) => s.drift), totalReturn)).toBeGreaterThan(0.5);
  });

  it("is always positive and integral", () => {
    for (const s of universe(7)) {
      expect(s.history.every((p) => Number.isInteger(p) && p > 0)).toBe(true);
    }
  });
});

describe("the fundamentals card carries real signal", () => {
  it("revenue growth tracks drift strongly", () => {
    const u = universe(11);
    expect(corr(u.map((s) => s.drift), u.map((s) => s.f.revenueGrowthPct))).toBeGreaterThan(0.85);
  });

  it("beta tracks volatility, not drift", () => {
    const u = universe(11);
    expect(corr(u.map((s) => s.vol), u.map((s) => s.f.beta))).toBeGreaterThan(0.9);
    expect(Math.abs(corr(u.map((s) => s.drift), u.map((s) => s.f.beta)))).toBeLessThan(0.4);
  });

  it("debt runs opposite to quality", () => {
    const u = universe(11);
    expect(corr(u.map((s) => s.drift), u.map((s) => s.f.debtToEquity))).toBeLessThan(-0.7);
  });

  it("analyst view is right more often than not, but not reliable", () => {
    // Averaged across many competitions so a single lucky draw cannot pass it.
    const cs: number[] = [];
    for (let c = 1; c <= 30; c++) {
      const u = universe(c);
      cs.push(corr(u.map((s) => s.drift), u.map((s) => s.f.analystTargetPaise / s.price)));
    }
    const mean = cs.reduce((a, b) => a + b, 0) / cs.length;
    expect(mean).toBeGreaterThan(0.4);  // worth listening to
    expect(mean).toBeLessThan(0.95);    // not gospel
  });

  it("the 52-week range brackets the price", () => {
    for (const s of universe(13)) {
      expect(s.f.low52Paise).toBeLessThanOrEqual(s.price);
      expect(s.f.high52Paise).toBeGreaterThanOrEqual(s.price);
    }
  });
});
