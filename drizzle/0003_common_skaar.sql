CREATE TABLE "page_captures" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"title" text,
	"markdown" text,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "competitor_listings" ADD COLUMN "match" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_listings" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "was_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "match" text;--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "capture_id" integer;--> statement-breakpoint
CREATE INDEX "page_captures_url_idx" ON "page_captures" USING btree ("url","fetched_at");--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD CONSTRAINT "competitor_prices_capture_id_page_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."page_captures"("id") ON DELETE set null ON UPDATE no action;