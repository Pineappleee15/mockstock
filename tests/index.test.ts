import { describe, it, expect } from "vitest";
import { marketIndex, INDEX_BASE } from "../src/lib/market-index";

interface Row { changeBps: number; pricePaise?: number; openPaise?: number; halted?: boolean }
const row = (changeBps: number): Row => ({ changeBps });

describe("market index", () => {
  it("starts at base with no movement", () => {
    const i = marketIndex([row(0), row(0)]);
    expect(i.value).toBe(INDEX_BASE);
    expect(i.returnBps).toBe(0);
  });

  it("is the equal-weighted mean, not a sum", () => {
    // Two stocks up 10% and one flat is +6.67%, not +20%.
    const i = marketIndex([row(1000), row(1000), row(0)]);
    expect(i.returnBps).toBe(667);
    expect(i.value).toBeCloseTo(1066.7, 1);
  });

  it("weights every stock the same regardless of price", () => {
    const cheap: Row = { ...row(1000), pricePaise: 100, openPaise: 91 };
    const dear: Row = { ...row(-1000), pricePaise: 1_000_000, openPaise: 1_111_111 };
    // One up 10%, one down 10% — a cap-weighted index would not be flat here.
    expect(marketIndex([cheap, dear]).returnBps).toBe(0);
  });

  it("survives an empty market", () => {
    expect(marketIndex([])).toEqual({ value: INDEX_BASE, returnBps: 0, constituents: 0 });
  });

  it("counts halted stocks, which are simply flat", () => {
    const halted: Row = { ...row(0), halted: true };
    const i = marketIndex([row(2000), halted]);
    expect(i.constituents).toBe(2);
    expect(i.returnBps).toBe(1000);
  });

  it("alpha preserves leaderboard order, since the market is common to all", () => {
    const market = marketIndex([row(500)]).returnBps;
    const teams = [1200, 300, 800, -200];
    const byReturn = [...teams].sort((a, b) => b - a);
    const byAlpha = [...teams].sort((a, b) => (b - market) - (a - market));
    expect(byAlpha).toEqual(byReturn);
  });
});
