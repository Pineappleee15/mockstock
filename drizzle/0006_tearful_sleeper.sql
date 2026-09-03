ALTER TABLE "holdings" DROP CONSTRAINT "holdings_qty_nonneg";--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "short_selling_enabled" boolean DEFAULT false NOT NULL;