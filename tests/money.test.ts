import { describe, it, expect } from "vitest";
import {
  applySpread, brokerageFor, mergeAverageCost, returnBps,
  formatPaise, formatRupees, formatBps, formatCompact, rupeesToPaise,
} from "../src/lib/money";

describe("spread", () => {
  it("rounds against the participant on both sides", () => {
    // Buys round up, sells round down, so a round trip can never mint paise.
    expect(applySpread(10000, "buy", 20)).toBe(10010);
    expect(applySpread(10000, "sell", 20)).toBe(9990);
  });

  it("never lets a round trip be profitable at a flat price", () => {
    for (const price of [1, 7, 99, 10000, 415000, 1234567]) {
      for (const spread of [0, 1, 20, 100]) {
        const buy = applySpread(price, "buy", spread);
        const sell = applySpread(price, "sell", spread);
        expect(sell).toBeLessThanOrEqual(buy);
      }
    }
  });

  it("returns integers", () => {
    for (let p = 1; p < 500; p++) {
      expect(Number.isInteger(applySpread(p, "buy", 20))).toBe(true);
      expect(Number.isInteger(applySpread(p, "sell", 20))).toBe(true);
    }
  });
});

describe("brokerage", () => {
  it("rounds up and is never zero on a real trade", () => {
    expect(brokerageFor(1000000, 5)).toBe(500);
    expect(brokerageFor(1, 5)).toBe(1);       // minimum one paisa
    expect(brokerageFor(0, 5)).toBe(0);       // but zero on a zero trade
    expect(brokerageFor(1000000, 0)).toBe(0); // and zero when disabled
  });
});

describe("average cost", () => {
  it("reconstructs total cost exactly, with no drift over many buys", () => {
    let qty = 0, avg = 0, residual = 0, spent = 0;
    for (let i = 1; i <= 200; i++) {
      const addQty = (i % 7) + 1;
      const addCost = addQty * (41500 + i * 13) + (i % 3); // deliberately not divisible
      const merged = mergeAverageCost(qty, avg, residual, addQty, addCost);
      qty += addQty;
      avg = merged.avgCost;
      residual = merged.residual;
      spent += addCost;
      expect(qty * avg + residual).toBe(spent);
    }
  });

  it("handles the empty position", () => {
    expect(mergeAverageCost(0, 0, 0, 0, 0)).toEqual({ avgCost: 0, residual: 0 });
    expect(mergeAverageCost(0, 0, 0, 10, 1000)).toEqual({ avgCost: 100, residual: 0 });
  });
});

describe("returns", () => {
  it("computes basis points from a starting value", () => {
    expect(returnBps(110, 100)).toBe(1000);
    expect(returnBps(90, 100)).toBe(-1000);
    expect(returnBps(100, 100)).toBe(0);
    expect(returnBps(100, 0)).toBe(0); // no divide by zero
  });
});

describe("formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatPaise(100000000)).toBe("10,00,000.00");   // 10 lakh
    expect(formatPaise(1000000000)).toBe("1,00,00,000.00"); // 1 crore
    expect(formatPaise(12345)).toBe("123.45");
    expect(formatPaise(5)).toBe("0.05");
  });

  it("handles negatives and signs", () => {
    expect(formatPaise(-12345)).toBe("-123.45");
    expect(formatRupees(12345, { sign: true })).toBe("₹+123.45");
    expect(formatRupees(-12345)).toBe("₹-123.45");
  });

  it("formats basis points and compact values", () => {
    expect(formatBps(1234)).toBe("12.34%");
    expect(formatBps(-50)).toBe("-0.50%");
    expect(formatCompact(100000000)).toBe("₹10.00L");
    expect(formatCompact(1000000000)).toBe("₹1.00Cr");
  });

  it("round-trips rupees to paise", () => {
    expect(rupeesToPaise(1234.56)).toBe(123456);
    expect(rupeesToPaise(0.01)).toBe(1);
  });
});
