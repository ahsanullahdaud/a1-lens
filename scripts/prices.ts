/**
 * Phase 2 — check competitor prices for crawled A1 products.
 *
 *   npm run prices:import                       # load data/competitor-urls.csv into the DB
 *   npm run prices                              # every product with a mapped URL (and eBay, if configured)
 *   npm run prices -- --limit 20
 *   npm run prices -- --source ebay --sku A1T-AAA,A1T-BBB   # one source, chosen products
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { eq, inArray, isNotNull, or } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { PoliteFetcher } from "../src/lib/crawler/http";
import { EbaySource } from "../src/lib/pricing/ebay-source";
import type { PriceObservation, PriceSource } from "../src/lib/pricing/types";
import { MappedUrlSource } from "../src/lib/pricing/url-source";

const CSV_PATH = "data/competitor-urls.csv";

const { values: args } = parseArgs({
  options: {
    import: { type: "boolean", default: false },
    limit: { type: "string", default: "50" },
    source: { type: "string" },
    sku: { type: "string" },
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

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toFixed(2)}`);

function describe(product: typeof schema.products.$inferSelect, o: PriceObservation): string {
  const head = `${product.name ?? product.slug} · A1 ${gbp(product.price)} (${product.conditionLabel ?? product.condition})`;
  if (o.status !== "ok" || o.price == null) return `${head}\n    ${o.retailer}: ${o.status.toUpperCase()}${o.note ? ` — ${o.note}` : ""}`;
  const gap = product.price != null ? ` → A1 is ${product.price <= o.price ? "cheaper" : "dearer"} by ${gbp(Math.abs(product.price - o.price))}` : "";
  const breakdown = o.shippingCost != null ? ` (${gbp(o.itemPrice)} + ${gbp(o.shippingCost)} postage)` : "";
  return [
    head,
    `    ${o.retailer}: ${gbp(o.price)}${breakdown}${gap}`,
    `    ${o.condition ?? "?"} · ${o.sellerType ?? "?"} seller${o.seller ? ` · ${o.seller}` : ""}${o.note ? ` · ${o.note}` : ""}`,
    `    "${o.title ?? ""}"`,
    `    ${o.url ?? ""}`,
  ].join("\n");
}

async function checkPrices() {
  const sources: PriceSource[] = [new MappedUrlSource(new PoliteFetcher()), new EbaySource()];
  const active = sources.filter((s) => s.isConfigured() && (!args.source || s.id === args.source));
  if (!active.length) {
    console.log(args.source ? `Source "${args.source}" is not configured — check .env.` : "No price source is configured.");
    return;
  }
  console.log(`Sources: ${active.map((s) => s.id).join(", ")}`);

  let targets;
  if (args.sku) {
    const skus = args.sku.split(",").map((s) => s.trim()).filter(Boolean);
    const rows = await db.select().from(schema.products).where(inArray(schema.products.sku, skus));
    // Keep the order the user typed.
    targets = skus.flatMap((sku) => rows.find((r) => r.sku === sku) ?? []);
    const missing = skus.filter((sku) => !rows.some((r) => r.sku === sku));
    if (missing.length) console.warn(`not crawled yet: ${missing.join(", ")}`);
  } else {
    const mapped = await db.selectDistinct({ id: schema.competitorListings.productId }).from(schema.competitorListings);
    const mappedIds = mapped.map((m) => m.id);
    const useEbay = active.some((s) => s.id === "ebay");
    // Mapped products always; with eBay active, anything with a GTIN too.
    const conditions = [
      mappedIds.length ? inArray(schema.products.id, mappedIds) : undefined,
      useEbay ? isNotNull(schema.products.gtin) : undefined,
    ].filter((c) => c !== undefined);
    if (!conditions.length) {
      console.log(`Nothing to check yet. Add rows to ${CSV_PATH} and run \`npm run prices:import\`, or set EBAY_CLIENT_ID/SECRET in .env.`);
      return;
    }
    targets = await db.select().from(schema.products).where(or(...conditions)).limit(Number(args.limit));
  }

  for (const [i, product] of targets.entries()) {
    for (const source of active) {
      const observations = await source.lookup(product);
      if (observations.length) {
        await db.insert(schema.competitorPrices).values(observations.map((o) => ({ productId: product.id, ...o })));
      }
      for (const o of observations) console.log(`\n[${i + 1}/${targets.length}] ${describe(product, o)}`);
    }
  }
}

(args.import ? importCsv() : checkPrices())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
