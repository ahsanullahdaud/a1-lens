ALTER TABLE "products" ADD COLUMN "segment" text;--> statement-breakpoint
CREATE INDEX "products_segment_idx" ON "products" USING btree ("segment");