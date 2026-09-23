/**
 * Load hand-parsed competitor prices (data/parsed-prices.json) into the database:
 * one page_captures row per page (raw markdown from the Parallel cache) and one
 * competitor_prices row per parse. Re-running skips rows already stored.
 *
 *   npm run prices:import            # first, so competitor_listings carry the match flags
 *   npx tsx scripts/import-parsed.ts [data/parsed-prices.json]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { readCapture } from "../src/lib/pricing/parallel";
import type { MatchQuality } from "../src/lib/pricing/types";

type ParsedRow = {
  i: number;
  sku: string;
  retailer: string;
  url: string;
  page_title: string | null;
  product_title: string | null;
  price: number | null;
  price_evidence: string | null;
  was_price: number | null;
  delivery_cost: number | null;
  delivery_note: string | null;
  stock: string;
  stock_note: string | null;
  match: MatchQuality;
  match_note: string | null;
  confidence: number;
  ignored: string[];
};

async function main() {
  const file = process.argv[2] ?? "data/parsed-prices.json";
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { parser: string; rows: ParsedRow[] };
  let stored = 0;
  let skipped = 0;

  for (const row of parsed.rows) {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.sku, row.sku)).limit(1);
    if (!product) {
      console.warn(`[${row.i}] no crawled product for ${row.sku} — skipped`);
      skipped++;
      continue;
    }
    const capture = readCapture(row.url);
    if (!capture) {
      console.warn(`[${row.i}] no cached page for ${row.url} — skipped`);
      skipped++;
      continue;
    }
    const fetchedAt = new Date(capture.fetchedAt);
    const [existing] = await db
      .select({ id: schema.competitorPrices.id })
      .from(schema.competitorPrices)
      .where(and(eq(schema.competitorPrices.url, row.url), eq(schema.competitorPrices.source, "parallel"), eq(schema.competitorPrices.capturedAt, fetchedAt)))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }

    const [page] = await db
      .insert(schema.pageCaptures)
      .values({
        url: row.url,
        source: "parallel",
        fetchedAt,
        title: capture.result?.title?.replace(/\s+/g, " ").trim() ?? row.page_title,
        markdown: capture.result?.full_content ?? null,
        meta: { extractId: capture.extractId, request: capture.request, parser: parsed.parser, error: capture.error ?? null },
      })
      .returning({ id: schema.pageCaptures.id });

    const landed = row.price == null ? null : row.price + (row.delivery_cost ?? 0);
    await db.insert(schema.competitorPrices).values({
      productId: product.id,
      source: "parallel",
      retailer: row.retailer,
      url: row.url,
      title: row.product_title ?? row.page_title,
      price: landed,
      itemPrice: row.price,
      shippingCost: row.delivery_cost,
      wasPrice: row.was_price,
      currency: "GBP",
      availability: row.stock,
      sellerType: "retailer",
      match: row.match,
      matchNote: row.match_note,
      captureId: page.id,
      status: row.price == null ? "no_price" : "ok",
      note: [
        `parsed by ${parsed.parser} (confidence ${row.confidence.toFixed(2)})`,
        row.price_evidence && `evidence: ${row.price_evidence}`,
        row.delivery_note && `delivery: ${row.delivery_note}`,
        row.stock_note && `stock: ${row.stock_note}`,
        row.ignored.length && `ignored: ${row.ignored.join("; ")}`,
      ]
        .filter(Boolean)
        .join(" · "),
      capturedAt: fetchedAt,
    });

    // Keep the mapping's flag in step with what the page showed.
    await db
      .update(schema.competitorListings)
      .set({ match: row.match, matchNote: row.match_note })
      .where(and(eq(schema.competitorListings.productId, product.id), eq(schema.competitorListings.url, row.url)));
    stored++;
    console.log(`[${row.i}] ${row.retailer.padEnd(18)} ${row.price == null ? "no price" : `£${landed!.toFixed(2)}`.padEnd(9)} ${row.match.padEnd(9)} ${product.name?.slice(0, 50)}`);
  }
  console.log(`\nStored ${stored}, skipped ${skipped} (already stored or unmatched).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
