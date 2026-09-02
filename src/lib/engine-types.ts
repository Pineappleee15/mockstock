/** Everything the price engine needs about a competition, in one flat object. */
export interface EngineConfig {
  tickIntervalSeconds: number;
  volatilityMultiplierBps: number;
  /** Regime volatility multiplier for this tick, from src/lib/regime.ts. */
  regimeVolMultiplier?: number;
  /** Scales every stock's liquidity, so order flow can be made to bite harder. */
  liquidityMultiplierBps?: number;
  orderFlowEnabled: boolean;
  impactCoefficientBps: number;
  maxImpactBpsPerTick: number;
  gapHalflifeSeconds: number;
  permanentImpactBps: number;
  circuitLimitBps: number;
}

export interface EngineStock {
  id: number;
  seed: number;
  volatilityBps: number;
  driftBps: number;
  liquidity: number;
  /** Exposure to the market factor. Same number shown on the fundamentals card. */
  beta: number;
  circuitLimitBps: number | null;
  sessionOpenPaise: number | null;
  halted: boolean;
}

/** Mutable per-stock state carried from one tick to the next. */
export interface StockState {
  pricePaise: number;
  anchorPaise: number;
  gapBps: number;
}

export interface TickInput {
  tickIndex: number;
  state: StockState;
  stock: EngineStock;
  /** Net signed quantity traded in the PREVIOUS tick. Positive = net buying. */
  netQty: number;
  /** Total news impact landing on this stock this tick, in bps. */
  newsDeltaBps: number;
  /** The market-wide move this tick, before beta. */
  marketBps?: number;
  /** A one-off unexplained jolt, if this stock drew one. */
  shockBps?: number;
  /** Admin forced price, if any. Overrides everything else. */
  overridePaise?: number | null;
}

export interface TickOutput {
  state: StockState;
  netQty: number;
  halted: boolean;
  /** Set when the circuit breaker fired on THIS tick. */
  breachedCircuit: boolean;
  /** Order-flow impact actually applied, for the audit log. */
  impactBps: number;
}
