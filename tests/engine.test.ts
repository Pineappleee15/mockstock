import { describe, it, expect } from "vitest";
import { computeTick, pullbackBps, newsSchedule, impactBpsFor, breachesCircuit } from "../src/lib/engine";
import { gaussian, uniform, hash32 } from "../src/lib/rng";
import type { EngineConfig, EngineStock } from "../src/lib/engine-types";

const cfg: EngineConfig = {
  tickIntervalSeconds: 5,
  volatilityMultiplierBps: 10000,
  orderFlowEnabled: true,
  impactCoefficientBps: 100,
  maxImpactBpsPerTick: 200,
  gapHalflifeSeconds: 90,
  permanentImpactBps: 3000,
  circuitLimitBps: 2000,
};

const stock: EngineStock = {
  id: 1, seed: 12345, volatilityBps: 30, driftBps: 0, liquidity: 500, beta: 1,
  circuitLimitBps: null, sessionOpenPaise: 100000, halted: false,
};

describe("rng determinism", () => {
  it("hash32 is stable", () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 2, 4));
  });

  it("uniform stays in [0,1)", () => {
    for (let i = 0; i < 5000; i++) {
      const u = uniform(42, i, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("gaussian has mean ~0 and sd ~1, truncated at 6 sigma", () => {
    let sum = 0, sumSq = 0, max = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const z = gaussian(7, i);
      sum += z; sumSq += z * z; max = Math.max(max, Math.abs(z));
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(Math.sqrt(sumSq / n) - 1)).toBeLessThan(0.05);
    expect(max).toBeLessThanOrEqual(6);
  });
});

describe("price path determinism", () => {
  it("produces identical paths from identical inputs", () => {
    const run = () => {
      let s = { pricePaise: 100000, anchorPaise: 100000, gapBps: 0 };
      const path: number[] = [];
      const pb = pullbackBps(cfg);
      for (let k = 0; k < 500; k++) {
        const out = computeTick({ tickIndex: k, state: s, stock, netQty: 0, newsDeltaBps: 0 }, cfg, pb);
        s = out.state;
        path.push(s.pricePaise);
      }
      return path;
    };
    expect(run()).toEqual(run());
  });

  it("prices are always positive integers", () => {
    let s = { pricePaise: 100, anchorPaise: 100, gapBps: 0 };
    const wild = { ...cfg, volatilityMultiplierBps: 100000 };
    const pb = pullbackBps(wild);
    const noCircuit: EngineStock = { ...stock, sessionOpenPaise: null };
    for (let k = 0; k < 3000; k++) {
      const out = computeTick({ tickIndex: k, state: s, stock: noCircuit, netQty: 0, newsDeltaBps: 0 }, wild, pb);
      s = out.state;
      expect(Number.isInteger(s.pricePaise)).toBe(true);
      expect(s.pricePaise).toBeGreaterThan(0);
    }
  });
});

describe("order flow impact", () => {
  it("is sub-linear in volume", () => {
    const small = impactBpsFor(500, stock, cfg);
    const big = impactBpsFor(5000, stock, cfg);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(small * 10); // sqrt, not linear
  });

  it("is symmetric and clamped", () => {
    expect(impactBpsFor(-500, stock, cfg)).toBe(-impactBpsFor(500, stock, cfg));
    expect(impactBpsFor(100_000_000, stock, cfg)).toBe(cfg.maxImpactBpsPerTick);
  });

  it("is off when disabled", () => {
    expect(impactBpsFor(5000, stock, { ...cfg, orderFlowEnabled: false })).toBe(0);
  });

  it("mean-reverts toward the anchor once flow stops", () => {
    const pb = pullbackBps(cfg);
    let s = { pricePaise: 100000, anchorPaise: 100000, gapBps: 0 };
    // Sustained buying.
    for (let k = 0; k < 10; k++) {
      s = computeTick({ tickIndex: k, state: s, stock, netQty: 2000, newsDeltaBps: 0 }, cfg, pb).state;
    }
    const peakGap = s.gapBps;
    expect(peakGap).toBeGreaterThan(0);
    // Flow stops.
    for (let k = 10; k < 100; k++) {
      s = computeTick({ tickIndex: k, state: s, stock, netQty: 0, newsDeltaBps: 0 }, cfg, pb).state;
    }
    expect(Math.abs(s.gapBps)).toBeLessThan(Math.abs(peakGap) / 4);
  });

  it("keeps a permanent share in the anchor", () => {
    const pb = pullbackBps(cfg);
    let s = { pricePaise: 100000, anchorPaise: 100000, gapBps: 0 };
    const flat: EngineStock = { ...stock, volatilityBps: 0, sessionOpenPaise: null };
    for (let k = 0; k < 20; k++) {
      s = computeTick({ tickIndex: k, state: s, stock: flat, netQty: 3000, newsDeltaBps: 0 }, cfg, pb).state;
    }
    expect(s.anchorPaise).toBeGreaterThan(100000); // sustained buying re-rated it
  });
});

describe("circuit breakers", () => {
  it("halts and clamps beyond the band", () => {
    const pb = pullbackBps(cfg);
    const s = { pricePaise: 100000, anchorPaise: 100000, gapBps: 0 };
    const out = computeTick({ tickIndex: 1, state: s, stock, netQty: 0, newsDeltaBps: 9000 }, cfg, pb);
    expect(out.breachedCircuit).toBe(true);
    expect(out.state.pricePaise).toBeLessThanOrEqual(120000);
  });

  it("freezes a halted stock completely", () => {
    const pb = pullbackBps(cfg);
    const s = { pricePaise: 100000, anchorPaise: 100000, gapBps: 500 };
    const out = computeTick(
      { tickIndex: 5, state: s, stock: { ...stock, halted: true }, netQty: 9999, newsDeltaBps: 500 }, cfg, pb);
    expect(out.state).toEqual(s);
    expect(out.netQty).toBe(0);
  });

  it("detects breaches in both directions", () => {
    expect(breachesCircuit(125000, stock, cfg)).toBe(true);
    expect(breachesCircuit(75000, stock, cfg)).toBe(true);
    expect(breachesCircuit(110000, stock, cfg)).toBe(false);
  });
});

describe("news schedule", () => {
  it("sums to exactly the requested impact", () => {
    for (const total of [500, -300, 1234, 7, -1]) {
      for (const ticks of [1, 2, 5, 24, 100]) {
        const sched = newsSchedule(total, ticks);
        expect(sched.reduce((a, b) => a + b, 0)).toBe(total);
        expect(sched).toHaveLength(ticks);
      }
    }
  });

  it("is front-loaded", () => {
    const s = newsSchedule(1000, 10);
    expect(s[0]!).toBeGreaterThan(s[9]!);
  });
});
