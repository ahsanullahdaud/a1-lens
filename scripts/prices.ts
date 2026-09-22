/**
 * Phase 2 — check competitor prices for crawled A1 products.
 *
 *   npm run prices:import            # load data/competitor-urls.csv into the DB
 *   npm run prices                   # check every product that has a mapped URL (and eBay, if configured)
 *   npm run prices -- --limit 20
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { eq, inArray, isNotNull, or } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { PoliteFetcher } from "../src/lib/crawler/http";
import { EbaySource } from "../src/lib/pricing/ebay-source";
import type { PriceSource } from "../src/lib/pricing/types";
import { MappedUrlSource } from "../src/lib/pricing/url-source";

const CSV_PATH = "data/competitor-urls.csv";

const { values: args } = parseArgs({
  options: {
    import: { type: "boolean", default: false },
    limit: { type: "string", default: "50" },
  },
});

/** CSV columns: a1_product (URL, SKU or GTIN), retailer, url. Lines starting with # are ignored. */
async function importCsv() {
  const lines = readFileSync(CSV_PATH, "utf8").split(/\r?\n/).map((l) => l.trim());
  let added = 0;
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.toLowerCase().startsWith("a1_product")) continue;
    const [key, retailer, url] = line.split(",").map((c) => c.trim());
    if (!key || !retailer || !url) {
      console.warn(`skipped malformed line: ${line}`);
      continue;
    }
    const [product] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(or(eq(schema.products.url, key), eq(schema.products.sku, key), eq(schema.products.gtin, key)))
      .limit(1);
    if (!product) {
      console.warn(`no crawled A1 product matches "${key}" — crawl it first`);
      continue;
    }
    const inserted = await db
      .insert(schema.competitorListings)
      .values({ productId: product.id, retailer, url })
      .onConflictDoNothing()
      .returning();
    added += inserted.length;
  }
  console.log(`Imported ${added} new competitor URL(s).`);
}

async function checkPrices() {
  const sources: PriceSource[] = [new MappedUrlSource(new PoliteFetcher()), new EbaySource()];
  const active = sources.filter((s) => s.isConfigured());
  console.log(`Sources: ${active.map((s) => s.id).join(", ")}`);

  const mapped = await db.selectDistinct({ id: schema.competitorListings.productId }).from(schema.competitorListings);
  const mappedIds = mapped.map((m) => m.id);
  const useEbay = active.some((s) => s.id === "ebay");

  // Mapped products always; with eBay configured, anything with a GTIN too.
  const conditions = [
    mappedIds.length ? inArray(schema.products.id, mappedIds) : undefined,
    useEbay ? isNotNull(schema.products.gtin) : undefined,
  ].filter((c) => c !== undefined);
  if (!conditions.length) {
    console.log(`Nothing to check yet. Add rows to ${CSV_PATH} and run \`npm run prices:import\`, or set EBAY_CLIENT_ID/SECRET in .env.`);
    return;
  }

  const targets = await db.select().from(schema.products).where(or(...conditions)).limit(Number(args.limit));
  for (const [i, product] of targets.entries()) {
    for (const source of active) {
      const observations = await source.lookup(product);
      if (observations.length) {
        await db.insert(schema.competitorPrices).values(observations.map((o) => ({ productId: product.id, ...o })));
      }
      for (const o of observations) {
        const delta = o.price != null && product.price != null ? ` (A1 £${product.price.toFixed(2)})` : "";
        console.log(`[${i + 1}/${targets.length}] ${o.retailer}: ${o.status}${o.price != null ? ` £${o.price.toFixed(2)}` : ""}${delta}  ${product.name ?? product.slug}`);
      }
    }
  }
}

(args.import ? importCsv() : checkPrices())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
