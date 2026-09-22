CREATE TABLE "audit_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"retailer" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"source" text NOT NULL,
	"retailer" text NOT NULL,
	"url" text,
	"title" text,
	"price" numeric(10, 2),
	"currency" text,
	"condition" text,
	"availability" text,
	"status" text NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"urls_planned" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"availability" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"slug" text NOT NULL,
	"sku" text,
	"gtin" text,
	"name" text,
	"brand" text,
	"category_path" text,
	"condition" text,
	"condition_label" text,
	"price" numeric(10, 2),
	"was_price" numeric(10, 2),
	"currency" text,
	"availability" text,
	"http_status" integer,
	"snapshot" jsonb,
	"audit_score" integer,
	"audited_at" timestamp with time zone,
	"sitemap_lastmod" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_crawled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_listings" ADD CONSTRAINT "competitor_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_prices" ADD CONSTRAINT "competitor_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_product_idx" ON "audit_findings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "findings_rule_idx" ON "audit_findings" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_listings_unique_idx" ON "competitor_listings" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "competitor_prices_product_idx" ON "competitor_prices" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_url_idx" ON "products" USING btree ("url");--> statement-breakpoint
CREATE INDEX "products_gtin_idx" ON "products" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "products_score_idx" ON "products" USING btree ("audit_score");