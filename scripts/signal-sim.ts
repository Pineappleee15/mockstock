import { computeTick, pullbackBps } from "../src/lib/engine";
import type { EngineConfig, EngineStock } from "../src/lib/engine-types";
import { driftFor, priceHistory, fundamentalsFor } from "../src/lib/fundamentals";
import { seedFromString } from "../src/lib/rng";
import { DEMO_STOCKS } from "./stocks-demo";

/**
 * Does reading the fundamentals actually pay?
 *
 * Simulates many independent events. In each, three strategies each pick three
 * stocks and hold for the whole session:
 *
 *   research  — highest revenue growth on the fundamentals card
 *   analyst   — biggest implied upside to the analyst target
 *   coin flip — three at random
 *
 * If research does not beat the coin flip, the card is decoration and should
 * not ship. If it beats it every single time, the event is a solved puzzle.
 */

const EVENTS = 400;
const HOURS = 3;

const cfg: EngineConfig = {
  tickIntervalSeconds: 5,
  volatilityMultiplierBps: 10000,
  orderFlowEnabled: false, // isolate the signal from team behaviour
  impactCoefficientBps: 100,
  maxImpactBpsPerTick: 200,
  gapHalflifeSeconds: 90,
  permanentImpactBps: 3000,
  circuitLimitBps: 100000, // no halts, so we measure the full path
};

const TICKS = (HOURS * 3600) / cfg.tickIntervalSeconds;
const pullback = pullbackBps(cfg);

function runEvent(compId: number) {
  const picks = DEMO_STOCKS.map((s) => {
    const price = Math.round(s.price * 100);
    const drift = driftFor(compId, s.symbol);
    const history = priceHistory(compId, s.symbol, price, s.volBps, drift);
    const f = fundamentalsFor(compId, s.symbol, price, s.volBps, drift, 1500, history);
    return { symbol: s.symbol, price, vol: s.volBps, drift, f };
  });

  // Run each stock's path to the close and record its return.
  const ret = new Map<string, number>();
  for (const p of picks) {
    const stock: EngineStock = {
      id: 0, seed: seedFromString(`${compId}:${p.symbol}`) % 2_000_000_000,
      volatilityBps: p.vol, driftBps: p.drift, liquidity: 1500, beta: 1,
      circuitLimitBps: null, sessionOpenPaise: null, halted: false,
    };
    let state = { pricePaise: p.price, anchorPaise: p.price, gapBps: 0 };
    for (let k = 1; k <= TICKS; k++) {
      state = computeTick(
        { tickIndex: k, state, stock, netQty: 0, newsDeltaBps: 0 }, cfg, pullback).state;
    }
    ret.set(p.symbol, (state.pricePaise - p.price) / p.price);
  }

  const avg = (syms: string[]) => syms.reduce((a, s) => a + ret.get(s)!, 0) / syms.length;

  const research = [...picks].sort((a, b) => b.f.revenueGrowthPct - a.f.revenueGrowthPct)
    .slice(0, 3).map((p) => p.symbol);
  const analyst = [...picks].sort((a, b) =>
    (b.f.analystTargetPaise / b.price) - (a.f.analystTargetPaise / a.price))
    .slice(0, 3).map((p) => p.symbol);
  const shuffled = [...picks].sort(() => Math.random() - 0.5).slice(0, 3).map((p) => p.symbol);

  return { research: avg(research), analyst: avg(analyst), coin: avg(shuffled) };
}

const totals = { research: 0, analyst: 0, coin: 0 };
let researchWins = 0;

for (let c = 1; c <= EVENTS; c++) {
  const r = runEvent(c);
  totals.research += r.research;
  totals.analyst += r.analyst;
  totals.coin += r.coin;
  if (r.research > r.coin) researchWins++;
}

const pct = (n: number) => ((n / EVENTS) * 100).toFixed(2) + "%";
console.log(`\n${EVENTS} simulated ${HOURS}-hour events, three stocks held to the close\n`);
console.log(`  research (top revenue growth)   ${pct(totals.research).padStart(8)}`);
console.log(`  analyst  (biggest upside)       ${pct(totals.analyst).padStart(8)}`);
console.log(`  coin flip (random three)        ${pct(totals.coin).padStart(8)}`);
console.log(`\n  research beat the coin flip in ${((researchWins / EVENTS) * 100).toFixed(0)}% of events`);

const edge = (totals.research - totals.coin) / EVENTS * 100;
console.log(`  edge from doing the reading: ${edge.toFixed(2)} percentage points per event\n`);

const ok = edge > 1 && researchWins / EVENTS > 0.55 && researchWins / EVENTS < 0.95;
console.log(ok
  ? "GOOD: research pays, but is not a guarantee"
  : "BAD: signal is either useless or too strong — retune");
process.exit(ok ? 0 : 1);
