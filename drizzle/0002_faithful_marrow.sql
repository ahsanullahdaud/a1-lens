ALTER TABLE "competitor_prices" ADD COLUMN "item_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "shipping_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "seller" text;--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD COLUMN "seller_type" text;