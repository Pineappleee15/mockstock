ALTER TYPE "public"."adjustment_kind" ADD VALUE 'market';--> statement-breakpoint
ALTER TYPE "public"."adjustment_kind" ADD VALUE 'shock';--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "regime_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "market_factor_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "liquidity_multiplier_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "shock_chance_bps" integer DEFAULT 15 NOT NULL;