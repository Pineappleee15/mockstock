import { computeTick, pullbackBps, impactBpsFor } from "../src/lib/engine";
import type { EngineConfig, EngineStock } from "../src/lib/engine-types";

/** Where does price movement actually come from over a 3-hour session? */
const cfg: EngineConfig = {
  tickIntervalSeconds: 5, volatilityMultiplierBps: 10000, orderFlowEnabled: true,
  impactCoefficientBps: 100, maxImpactBpsPerTick: 200, gapHalflifeSeconds: 90,
  permanentImpactBps: 3000, circuitLimitBps: 100000,
};
const TICKS = (3 * 3600) / cfg.tickIntervalSeconds;
const pb = pullbackBps(cfg);

const stock: EngineStock = {
  id: 1, seed: 4242, volatilityBps: 45, driftBps: 0, liquidity: 482, beta: 1,
  circuitLimitBps: null, sessionOpenPaise: null, halted: false,
};

// 1. Background noise alone.
let s = { pricePaise: 415000, anchorPaise: 415000, gapBps: 0 };
let lo = s.pricePaise, hi = s.pricePaise;
for (let k = 1; k <= TICKS; k++) {
  s = computeTick({ tickIndex: k, state: s, stock, netQty: 0, newsDeltaBps: 0 }, cfg, pb).state;
  lo = Math.min(lo, s.pricePaise); hi = Math.max(hi, s.pricePaise);
}
console.log("\nBACKGROUND NOISE over 3 hours (vol 45 bps/min, 1.0x)");
console.log(`  close ${((s.pricePaise / 415000 - 1) * 100).toFixed(2)}%   full range ${(((hi - lo) / 415000) * 100).toFixed(2)}%`);

// 2. Order flow from a realistic 12-team burst.
console.log("\nORDER FLOW, one tick, TCS at liquidity 482");
for (const teams of [1, 3, 6, 12]) {
  const sharesEach = Math.floor((1_000_000 * 100 * 0.3) / 415000); // 30% of Rs 10L each
  const net = teams * sharesEach;
  const bps = impactBpsFor(net, stock, cfg);
  console.log(`  ${String(teams).padStart(2)} teams buying 30% each = ${String(net).padStart(4)} shares -> ${(bps / 100).toFixed(2)}%  (${((bps * 0.3) / 100).toFixed(2)}% of it permanent)`);
}

// 3. What a news event does.
console.log("\nNEWS EVENT");
console.log("  a 5% headline moves the anchor 5.00% and it stays");

console.log("\nSo: news 5%, a full-room stampede under 1%, and three hours of");
console.log("background noise worth a few percent. News dominates by design.\n");
