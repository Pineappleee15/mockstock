ALTER TABLE "stocks" ADD COLUMN "intra_tick_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "intra_tick_at" integer DEFAULT -1 NOT NULL;