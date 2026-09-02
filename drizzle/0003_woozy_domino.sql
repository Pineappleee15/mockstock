CREATE TYPE "public"."news_status" AS ENUM('queued', 'published');--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "market_factor_bps" SET DEFAULT 6000;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "auto_news_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "news_events" ADD COLUMN "status" "news_status" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "news_events" ADD COLUMN "arc_id" text;--> statement-breakpoint
ALTER TABLE "news_events" ADD COLUMN "arc_step" integer;