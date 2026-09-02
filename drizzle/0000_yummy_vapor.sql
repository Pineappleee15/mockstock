CREATE TYPE "public"."actor_type" AS ENUM('admin', 'team', 'system');--> statement-breakpoint
CREATE TYPE "public"."adjustment_kind" AS ENUM('news', 'order_flow', 'override');--> statement-breakpoint
CREATE TYPE "public"."market_mode" AS ENUM('event', 'league');--> statement-breakpoint
CREATE TYPE "public"."market_state" AS ENUM('draft', 'pre_open', 'open', 'paused', 'closed', 'ended');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('filled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."stock_status" AS ENUM('active', 'halted');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" bigint,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" "market_mode" NOT NULL,
	"state" "market_state" DEFAULT 'draft' NOT NULL,
	"starting_cash_paise" bigint DEFAULT 100000000 NOT NULL,
	"brokerage_bps" integer DEFAULT 5 NOT NULL,
	"spread_bps" integer DEFAULT 20 NOT NULL,
	"concentration_cap_bps" integer DEFAULT 4000 NOT NULL,
	"order_rate_limit_per_min" integer DEFAULT 30 NOT NULL,
	"circuit_limit_bps" integer DEFAULT 2000 NOT NULL,
	"tick_interval_seconds" integer DEFAULT 5 NOT NULL,
	"volatility_multiplier_bps" integer DEFAULT 10000 NOT NULL,
	"leaderboard_every_n_ticks" integer DEFAULT 2 NOT NULL,
	"order_flow_enabled" boolean DEFAULT true NOT NULL,
	"impact_coefficient_bps" integer DEFAULT 100 NOT NULL,
	"max_impact_bps_per_tick" integer DEFAULT 200 NOT NULL,
	"gap_halflife_seconds" integer DEFAULT 90 NOT NULL,
	"permanent_impact_bps" integer DEFAULT 3000 NOT NULL,
	"current_tick" integer DEFAULT 0 NOT NULL,
	"last_tick_at" timestamp with time zone,
	"session_opened_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"portfolio_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"avg_cost_paise" bigint NOT NULL,
	"cost_residual" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_qty_nonneg" CHECK ("holdings"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leaderboard_archive" (
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"tick_index" integer NOT NULL,
	"rank" integer NOT NULL,
	"portfolio_value_paise" bigint NOT NULL,
	"return_bps" integer NOT NULL,
	CONSTRAINT "leaderboard_archive_competition_id_team_id_tick_index_pk" PRIMARY KEY("competition_id","team_id","tick_index")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_current" (
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"rank" integer NOT NULL,
	"prev_rank" integer,
	"portfolio_value_paise" bigint NOT NULL,
	"cash_paise" bigint NOT NULL,
	"invested_paise" bigint NOT NULL,
	"return_bps" integer NOT NULL,
	"realised_pnl_paise" bigint NOT NULL,
	"unrealised_pnl_paise" bigint NOT NULL,
	"trade_count" integer NOT NULL,
	"tick_index" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_current_competition_id_team_id_pk" PRIMARY KEY("competition_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "market_windows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"rebase_session_open" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_event_stocks" (
	"news_event_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"impact_bps" integer,
	CONSTRAINT "news_event_stocks_news_event_id_stock_id_pk" PRIMARY KEY("news_event_id","stock_id")
);
--> statement-breakpoint
CREATE TABLE "news_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"headline" text NOT NULL,
	"body" text,
	"impact_bps" integer NOT NULL,
	"decay_seconds" integer DEFAULT 120 NOT NULL,
	"start_tick" integer NOT NULL,
	"end_tick" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" integer NOT NULL,
	"status" "order_status" NOT NULL,
	"reject_code" text,
	"reject_detail" text,
	"tick_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_qty_min" CHECK ("orders"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"cash_paise" bigint NOT NULL,
	"realised_pnl_paise" bigint DEFAULT 0 NOT NULL,
	"brokerage_paid_paise" bigint DEFAULT 0 NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "portfolios_cash_nonneg" CHECK ("portfolios"."cash_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"tick_index" integer NOT NULL,
	"kind" "adjustment_kind" NOT NULL,
	"delta_bps" integer,
	"target_paise" bigint,
	"news_event_id" bigint,
	"net_qty" integer,
	"reason" text,
	"actor_type" "actor_type" DEFAULT 'system' NOT NULL,
	"actor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_ticks" (
	"competition_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"tick_index" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"price_paise" bigint NOT NULL,
	"anchor_paise" bigint NOT NULL,
	"gap_bps" integer NOT NULL,
	"net_qty" integer DEFAULT 0 NOT NULL,
	"halted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_ticks_stock_id_tick_index_pk" PRIMARY KEY("stock_id","tick_index")
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"starting_price_paise" bigint NOT NULL,
	"volatility_bps" integer DEFAULT 30 NOT NULL,
	"drift_bps" integer DEFAULT 0 NOT NULL,
	"liquidity" integer DEFAULT 500 NOT NULL,
	"circuit_limit_bps" integer,
	"status" "stock_status" DEFAULT 'active' NOT NULL,
	"halted_at" timestamp with time zone,
	"halt_reason" text,
	"seed" integer NOT NULL,
	"session_open_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competition_id" bigint NOT NULL,
	"name" text NOT NULL,
	"members" text DEFAULT '' NOT NULL,
	"join_code" text NOT NULL,
	"password_hash" text,
	"must_set_password" boolean DEFAULT true NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"competition_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"stock_id" bigint NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" integer NOT NULL,
	"mid_price_paise" bigint NOT NULL,
	"fill_price_paise" bigint NOT NULL,
	"gross_paise" bigint NOT NULL,
	"brokerage_paise" bigint NOT NULL,
	"cash_delta_paise" bigint NOT NULL,
	"avg_cost_at_fill" bigint,
	"realised_pnl_paise" bigint DEFAULT 0 NOT NULL,
	"tick_index" integer NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" bigint,
	CONSTRAINT "trades_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_archive" ADD CONSTRAINT "leaderboard_archive_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_archive" ADD CONSTRAINT "leaderboard_archive_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_current" ADD CONSTRAINT "leaderboard_current_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_current" ADD CONSTRAINT "leaderboard_current_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_windows" ADD CONSTRAINT "market_windows_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_event_stocks" ADD CONSTRAINT "news_event_stocks_news_event_id_news_events_id_fk" FOREIGN KEY ("news_event_id") REFERENCES "public"."news_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_event_stocks" ADD CONSTRAINT "news_event_stocks_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_news_event_id_news_events_id_fk" FOREIGN KEY ("news_event_id") REFERENCES "public"."news_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD CONSTRAINT "price_ticks_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD CONSTRAINT "price_ticks_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_voided_by_admins_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_comp_idx" ON "audit_log" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_pf_stock_uq" ON "holdings" USING btree ("portfolio_id","stock_id");--> statement-breakpoint
CREATE INDEX "lb_rank_idx" ON "leaderboard_current" USING btree ("competition_id","rank");--> statement-breakpoint
CREATE INDEX "market_windows_comp_idx" ON "market_windows" USING btree ("competition_id","opens_at");--> statement-breakpoint
CREATE INDEX "news_comp_idx" ON "news_events" USING btree ("competition_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idem_uq" ON "orders" USING btree ("team_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_rate_limit" ON "orders" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_comp_idx" ON "orders" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "padj_comp_tick_idx" ON "price_adjustments" USING btree ("competition_id","tick_index");--> statement-breakpoint
CREATE INDEX "padj_stock_tick_idx" ON "price_adjustments" USING btree ("stock_id","tick_index");--> statement-breakpoint
CREATE INDEX "price_ticks_snapshot" ON "price_ticks" USING btree ("competition_id","tick_index");--> statement-breakpoint
CREATE UNIQUE INDEX "stocks_comp_symbol_uq" ON "stocks" USING btree ("competition_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_comp_name_uq" ON "teams" USING btree ("competition_id","name");--> statement-breakpoint
CREATE INDEX "trades_comp_idx" ON "trades" USING btree ("competition_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_team_idx" ON "trades" USING btree ("team_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_flow_idx" ON "trades" USING btree ("stock_id","tick_index");