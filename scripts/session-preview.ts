import { computeTick, pullbackBps } from "../src/lib/engine";
import type { EngineConfig, EngineStock } from "../src/lib/engine-types";
import { marketFactorBps, shockAt, regimeAt } from "../src/lib/regime";
import { betaFor, driftFor } from "../src/lib/fundamentals";
import { seedFromString } from "../src/lib/rng";
import { DEMO_STOCKS } from "./stocks-demo";

/** What does a three-hour session actually look like now? */
const COMP = Number(process.argv[2] ?? 1);
const VOL_MULT = Number(process.argv[3] ?? 10000);
const FACTOR = Number(process.argv[4] ?? 10000);
const NO_REGIME = process.argv[5] === "off";

const cfg: EngineConfig = {
  tickIntervalSeconds: 5, volatilityMultiplierBps: VOL_MULT, orderFlowEnabled: true,
  impactCoefficientBps: 100, maxImpactBpsPerTick: 200, gapHalflifeSeconds: 90,
  permanentImpactBps: 3000, circuitLimitBps: 100000, liquidityMultiplierBps: 10000,
};
const TICKS = (3 * 3600) / cfg.tickIntervalSeconds;
const pb = pullbackBps(cfg);

const stocks = DEMO_STOCKS.map((s) => ({
  symbol: s.symbol,
  open: Math.round(s.price * 100),
  engine: {
    id: 0, seed: seedFromString(`${COMP}:${s.symbol}`) % 2_000_000_000,
    volatilityBps: s.volBps, driftBps: driftFor(COMP, s.symbol), liquidity: 500,
    beta: betaFor(COMP, s.symbol, s.volBps),
    circuitLimitBps: null, sessionOpenPaise: null, halted: false,
  } as EngineStock,
  state: { pricePaise: Math.round(s.price * 100), anchorPaise: Math.round(s.price * 100), gapBps: 0 },
  lo: Math.round(s.price * 100), hi: Math.round(s.price * 100),
}));

const timeline: string[] = [];
let lastRegime = "";

for (let k = 1; k <= TICKS; k++) {
  const f = marketFactorBps(COMP, k, 5, TICKS, NO_REGIME ? 0 : FACTOR);
  cfg.regimeVolMultiplier = NO_REGIME ? 1 : f.regime.volMultiplier;
  const sh = shockAt(COMP, k, stocks.length, 15);

  if (f.regime.label !== lastRegime) {
    const mins = Math.round((k * 5) / 60);
    timeline.push(`${String(mins).padStart(3)}m  ${f.regime.label}`);
    lastRegime = f.regime.label;
  }
  if (sh) {
    const mins = Math.round((k * 5) / 60);
    timeline.push(`${String(mins).padStart(3)}m    shock ${stocks[sh.stockIndex]!.symbol} ${(sh.deltaBps / 100).toFixed(1)}%`);
  }

  for (let i = 0; i < stocks.length; i++) {
    const st = stocks[i]!;
    st.state = computeTick({
      tickIndex: k, state: st.state, stock: st.engine, netQty: 0, newsDeltaBps: 0,
      marketBps: f.bps, shockBps: sh?.stockIndex === i ? sh.deltaBps : 0,
    }, cfg, pb).state;
    st.lo = Math.min(st.lo, st.state.pricePaise);
    st.hi = Math.max(st.hi, st.state.pricePaise);
  }
}

console.log(`\nSESSION PREVIEW  competition ${COMP}, volatility ${(VOL_MULT / 10000).toFixed(1)}x\n`);
console.log("  How the session unfolded:");
for (const line of timeline.slice(0, 22)) console.log("   ", line);
if (timeline.length > 22) console.log(`    ... and ${timeline.length - 22} more`);

const closes = stocks.map((s) => (s.state.pricePaise / s.open - 1) * 100);
const ranges = stocks.map((s) => ((s.hi - s.lo) / s.open) * 100);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`\n  market close      ${mean(closes) >= 0 ? "+" : ""}${mean(closes).toFixed(2)}%`);
console.log(`  best stock        +${Math.max(...closes).toFixed(2)}%   worst ${Math.min(...closes).toFixed(2)}%`);
console.log(`  average swing     ${mean(ranges).toFixed(2)}%  (widest ${Math.max(...ranges).toFixed(2)}%)`);
console.log(`  regime changes    ${timeline.filter((t) => !t.includes("shock")).length}`);
console.log(`  shocks            ${timeline.filter((t) => t.includes("shock")).length}\n`);
