import {
  pgTable, pgEnum, bigserial, bigint, integer, text, boolean,
  timestamp, uuid, jsonb, uniqueIndex, index, primaryKey, check,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

/* ────────────────────────────  enums  ──────────────────────────── */

export const marketMode = pgEnum("market_mode", ["event", "league"]);
export const marketState = pgEnum("market_state", [
  "draft", "pre_open", "open", "paused", "closed", "ended",
]);
export const stockStatus = pgEnum("stock_status", ["active", "halted"]);
export const orderSide = pgEnum("order_side", ["buy", "sell"]);
export const orderStatus = pgEnum("order_status", ["filled", "rejected"]);
export const adjustmentKind = pgEnum("adjustment_kind", ["news", "order_flow", "override", "market", "shock"]);
export const actorType = pgEnum("actor_type", ["admin", "team", "system"]);

/* ────────────────────────────  identity  ──────────────────────────── */

export const admins = pgTable("admins", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────  competition  ──────────────────────────── */

export const competitions = pgTable("competitions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  mode: marketMode("mode").notNull(),
  state: marketState("state").notNull().default("draft"),

  startingCashPaise: bigint("starting_cash_paise", { mode: "number" }).notNull().default(100_000_000),
  brokerageBps: integer("brokerage_bps").notNull().default(5),
  spreadBps: integer("spread_bps").notNull().default(20),
  concentrationCapBps: integer("concentration_cap_bps").notNull().default(4000),
  orderRateLimitPerMin: integer("order_rate_limit_per_min").notNull().default(30),
  circuitLimitBps: integer("circuit_limit_bps").notNull().default(2000),

  tickIntervalSeconds: integer("tick_interval_seconds").notNull().default(5),
  volatilityMultiplierBps: integer("volatility_multiplier_bps").notNull().default(10000),
  leaderboardEveryNTicks: integer("leaderboard_every_n_ticks").notNull().default(2),

  // order-flow impact — the primary price driver (PLAN.md 3.1-3.2)
  orderFlowEnabled: boolean("order_flow_enabled").notNull().default(true),
  impactCoefficientBps: integer("impact_coefficient_bps").notNull().default(100),
  maxImpactBpsPerTick: integer("max_impact_bps_per_tick").notNull().default(200),
  gapHalflifeSeconds: integer("gap_halflife_seconds").notNull().default(90),
  permanentImpactBps: integer("permanent_impact_bps").notNull().default(3000),

  // Market regime: a common factor moving every stock together, in phases over
  // the session. Without it stocks are independent and the market never has a
  // mood — no shared panic, no recovery, no arc.
  regimeEnabled: boolean("regime_enabled").notNull().default(true),
  marketFactorBps: integer("market_factor_bps").notNull().default(6000),
  /** Scales every stock's liquidity, so order flow can be made to bite harder. */
  liquidityMultiplierBps: integer("liquidity_multiplier_bps").notNull().default(10000),
  /** Chance per tick that a random stock takes an unexplained shock. */
  shockChanceBps: integer("shock_chance_bps").notNull().default(15),

  currentTick: integer("current_tick").notNull().default(0),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  sessionOpenedAt: timestamp("session_opened_at", { withTimezone: true }),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketWindows = pgTable("market_windows", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  rebaseSessionOpen: boolean("rebase_session_open").notNull().default(true),
}, (t) => [index("market_windows_comp_idx").on(t.competitionId, t.opensAt)]);

export const teams = pgTable("teams", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  members: text("members").notNull().default(""),
  joinCode: text("join_code").notNull().unique(),
  passwordHash: text("password_hash"),
  mustSetPassword: boolean("must_set_password").notNull().default(true),
  isDisabled: boolean("is_disabled").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(1),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("teams_comp_name_uq").on(t.competitionId, t.name)]);

/* ────────────────────────────  stocks & prices  ──────────────────────────── */

export const stocks = pgTable("stocks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),

  startingPricePaise: bigint("starting_price_paise", { mode: "number" }).notNull(),
  volatilityBps: integer("volatility_bps").notNull().default(30),
  driftBps: integer("drift_bps").notNull().default(0),
  liquidity: integer("liquidity").notNull().default(500),
  circuitLimitBps: integer("circuit_limit_bps"),

  status: stockStatus("status").notNull().default("active"),
  haltedAt: timestamp("halted_at", { withTimezone: true }),
  haltReason: text("halt_reason"),
  seed: integer("seed").notNull(),

  sessionOpenPaise: bigint("session_open_paise", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("stocks_comp_symbol_uq").on(t.competitionId, t.symbol)]);

export const priceTicks = pgTable("price_ticks", {
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  tickIndex: integer("tick_index").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),

  pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
  anchorPaise: bigint("anchor_paise", { mode: "number" }).notNull(),
  gapBps: integer("gap_bps").notNull(),
  netQty: integer("net_qty").notNull().default(0),
  halted: boolean("halted").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.stockId, t.tickIndex] }),
  index("price_ticks_snapshot").on(t.competitionId, t.tickIndex),
]);

export const newsEvents = pgTable("news_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  headline: text("headline").notNull(),
  body: text("body"),
  impactBps: integer("impact_bps").notNull(),
  decaySeconds: integer("decay_seconds").notNull().default(120),
  startTick: integer("start_tick").notNull(),
  endTick: integer("end_tick").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: bigint("created_by", { mode: "number" }).references(() => admins.id),
}, (t) => [index("news_comp_idx").on(t.competitionId, t.publishedAt)]);

export const newsEventStocks = pgTable("news_event_stocks", {
  newsEventId: bigint("news_event_id", { mode: "number" }).notNull()
    .references(() => newsEvents.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  impactBps: integer("impact_bps"),
}, (t) => [primaryKey({ columns: [t.newsEventId, t.stockId] })]);

export const priceAdjustments = pgTable("price_adjustments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  tickIndex: integer("tick_index").notNull(),
  kind: adjustmentKind("kind").notNull(),
  deltaBps: integer("delta_bps"),
  targetPaise: bigint("target_paise", { mode: "number" }),
  newsEventId: bigint("news_event_id", { mode: "number" })
    .references(() => newsEvents.id, { onDelete: "set null" }),
  netQty: integer("net_qty"),
  reason: text("reason"),
  actorType: actorType("actor_type").notNull().default("system"),
  actorId: bigint("actor_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("padj_comp_tick_idx").on(t.competitionId, t.tickIndex),
  index("padj_stock_tick_idx").on(t.stockId, t.tickIndex),
]);

/* ────────────────────────────  portfolios  ──────────────────────────── */

export const portfolios = pgTable("portfolios", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull().unique()
    .references(() => teams.id, { onDelete: "cascade" }),
  cashPaise: bigint("cash_paise", { mode: "number" }).notNull(),
  realisedPnlPaise: bigint("realised_pnl_paise", { mode: "number" }).notNull().default(0),
  brokeragePaidPaise: bigint("brokerage_paid_paise", { mode: "number" }).notNull().default(0),
  tradeCount: integer("trade_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("portfolios_cash_nonneg", sql`${t.cashPaise} >= 0`)]);

export const holdings = pgTable("holdings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  portfolioId: bigint("portfolio_id", { mode: "number" }).notNull()
    .references(() => portfolios.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  avgCostPaise: bigint("avg_cost_paise", { mode: "number" }).notNull(),
  costResidual: bigint("cost_residual", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("holdings_pf_stock_uq").on(t.portfolioId, t.stockId),
  check("holdings_qty_nonneg", sql`${t.quantity} >= 0`),
]);

/**
 * Stocks a team has starred.
 *
 * Server-side rather than in the browser: a team shares one login across
 * several phones, so a watchlist held locally would differ per device and
 * vanish when someone signed in somewhere else.
 */
export const watchlist = pgTable("watchlist", {
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.teamId, t.stockId] }),
  index("watchlist_team_idx").on(t.teamId),
]);

/* ────────────────────────────  orders & trades  ──────────────────────────── */

export const orders = pgTable("orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  idempotencyKey: uuid("idempotency_key").notNull(),
  side: orderSide("side").notNull(),
  quantity: integer("quantity").notNull(),
  status: orderStatus("status").notNull(),
  rejectCode: text("reject_code"),
  rejectDetail: text("reject_detail"),
  tickIndex: integer("tick_index").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("orders_idem_uq").on(t.teamId, t.idempotencyKey),
  index("orders_rate_limit").on(t.teamId, t.createdAt),
  index("orders_comp_idx").on(t.competitionId, t.createdAt),
  check("orders_qty_min", sql`${t.quantity} >= 1`),
]);

export const trades = pgTable("trades", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull().unique()
    .references(() => orders.id, { onDelete: "cascade" }),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  stockId: bigint("stock_id", { mode: "number" }).notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  side: orderSide("side").notNull(),
  quantity: integer("quantity").notNull(),

  midPricePaise: bigint("mid_price_paise", { mode: "number" }).notNull(),
  fillPricePaise: bigint("fill_price_paise", { mode: "number" }).notNull(),
  grossPaise: bigint("gross_paise", { mode: "number" }).notNull(),
  brokeragePaise: bigint("brokerage_paise", { mode: "number" }).notNull(),
  cashDeltaPaise: bigint("cash_delta_paise", { mode: "number" }).notNull(),
  avgCostAtFill: bigint("avg_cost_at_fill", { mode: "number" }),
  realisedPnlPaise: bigint("realised_pnl_paise", { mode: "number" }).notNull().default(0),

  tickIndex: integer("tick_index").notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),

  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  voidedBy: bigint("voided_by", { mode: "number" }).references(() => admins.id),
}, (t) => [
  index("trades_comp_idx").on(t.competitionId, t.executedAt),
  index("trades_team_idx").on(t.teamId, t.executedAt),
  index("trades_flow_idx").on(t.stockId, t.tickIndex),
]);

export const cashAdjustments = pgTable("cash_adjustments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  createdBy: bigint("created_by", { mode: "number" }).references(() => admins.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────  leaderboard  ──────────────────────────── */

export const leaderboardCurrent = pgTable("leaderboard_current", {
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  prevRank: integer("prev_rank"),
  portfolioValuePaise: bigint("portfolio_value_paise", { mode: "number" }).notNull(),
  cashPaise: bigint("cash_paise", { mode: "number" }).notNull(),
  investedPaise: bigint("invested_paise", { mode: "number" }).notNull(),
  returnBps: integer("return_bps").notNull(),
  realisedPnlPaise: bigint("realised_pnl_paise", { mode: "number" }).notNull(),
  unrealisedPnlPaise: bigint("unrealised_pnl_paise", { mode: "number" }).notNull(),
  tradeCount: integer("trade_count").notNull(),
  tickIndex: integer("tick_index").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.competitionId, t.teamId] }),
  index("lb_rank_idx").on(t.competitionId, t.rank),
]);

export const leaderboardArchive = pgTable("leaderboard_archive", {
  competitionId: bigint("competition_id", { mode: "number" }).notNull()
    .references(() => competitions.id, { onDelete: "cascade" }),
  teamId: bigint("team_id", { mode: "number" }).notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  tickIndex: integer("tick_index").notNull(),
  rank: integer("rank").notNull(),
  portfolioValuePaise: bigint("portfolio_value_paise", { mode: "number" }).notNull(),
  returnBps: integer("return_bps").notNull(),
}, (t) => [primaryKey({ columns: [t.competitionId, t.teamId, t.tickIndex] })]);

/* ────────────────────────────  audit  ──────────────────────────── */

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  competitionId: bigint("competition_id", { mode: "number" })
    .references(() => competitions.id, { onDelete: "cascade" }),
  actorType: actorType("actor_type").notNull(),
  actorId: bigint("actor_id", { mode: "number" }),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: bigint("entity_id", { mode: "number" }),
  payload: jsonb("payload").notNull().default({}),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_comp_idx").on(t.competitionId, t.createdAt),
  index("audit_action_idx").on(t.action, t.createdAt),
]);

/* ────────────────────────────  relations  ──────────────────────────── */

export const teamRelations = relations(teams, ({ one, many }) => ({
  competition: one(competitions, { fields: [teams.competitionId], references: [competitions.id] }),
  portfolio: one(portfolios, { fields: [teams.id], references: [portfolios.teamId] }),
  orders: many(orders),
  trades: many(trades),
}));

export const portfolioRelations = relations(portfolios, ({ one, many }) => ({
  team: one(teams, { fields: [portfolios.teamId], references: [teams.id] }),
  holdings: many(holdings),
}));

export const holdingRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, { fields: [holdings.portfolioId], references: [portfolios.id] }),
  stock: one(stocks, { fields: [holdings.stockId], references: [stocks.id] }),
}));

export const stockRelations = relations(stocks, ({ one, many }) => ({
  competition: one(competitions, { fields: [stocks.competitionId], references: [competitions.id] }),
  ticks: many(priceTicks),
}));

export const tradeRelations = relations(trades, ({ one }) => ({
  order: one(orders, { fields: [trades.orderId], references: [orders.id] }),
  team: one(teams, { fields: [trades.teamId], references: [teams.id] }),
  stock: one(stocks, { fields: [trades.stockId], references: [stocks.id] }),
}));

export type Competition = typeof competitions.$inferSelect;
export type Stock = typeof stocks.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Portfolio = typeof portfolios.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type PriceTick = typeof priceTicks.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewsEvent = typeof newsEvents.$inferSelect;
export type Watchlist = typeof watchlist.$inferSelect;
