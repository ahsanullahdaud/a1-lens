/**
 * Phase 2 — competitor prices for retailers that refuse crawlers, via the
 * Parallel Extract API (page → markdown, cached on disk) and an LLM pass that
 * picks the main product's own price out of the page.
 *
 *   npm run extract                                  # dry run: fetch (cached), parse (cached), print the table
 *   npm run extract -- --retailer Currys             # one retailer
 *   npm run extract -- --import                      # also write page_captures + competitor_prices
 *   npm run extract -- --refresh                     # ignore the page cache and fetch again (costs money)
 *   npm run extract -- --reparse                     # ignore the parse cache (costs money)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, inArray, or } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { isLlmConfigured, parseListing, type ParseOutcome } from "../src/lib/pricing/llm-parse";
import { extractPages, type PageCapture } from "../src/lib/pricing/parallel";
import type { MatchQuality } from "../src/lib/pricing/types";

const CSV_PATH = "data/competitor-urls.csv";
const OBJECTIVE = "The main product's current price, any was/RRP price, delivery cost to the UK and whether it is in stock.";
const MATCH_RANK: Record<MatchQuality, number> = { exact: 0, uncertain: 1, near: 2 };

const { values: args } = parseArgs({
  options: {
    retailer: { type: "string" },
    import: { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    reparse: { type: "boolean", default: false },
  },
});

type Mapping = { key: string; retailer: string; url: string; match: MatchQuality; note: string };

function readMappings(): Mapping[] {
  return readFileSync(CSV_PATH, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.toLowerCase().startsWith("a1_product"))
    .map((line) => {
      const [key, retailer, url, match = "exact", ...note] = line.split(",").map((c) => c.trim());
      return { key, retailer, url, match: match as MatchQuality, note: note.join(",") };
    })
    .filter((m) => m.key && m.retailer && m.url && (!args.retailer || m.retailer.toLowerCase() === args.retailer.toLowerCase()));
}

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toFixed(2)}`);
const cut = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

async function main() {
  const mappings = readMappings();
  if (!mappings.length) throw new Error(`No rows in ${CSV_PATH}${args.retailer ? ` for retailer ${args.retailer}` : ""}.`);

  const keys = [...new Set(mappings.map((m) => m.key))];
  const products = await db
    .select()
    .from(schema.products)
    .where(or(inArray(schema.products.sku, keys), inArray(schema.products.url, keys), inArray(schema.products.gtin, keys)));
  const productFor = (key: string) => products.find((p) => p.sku === key || p.url === key || p.gtin === key);

  // 1. Pages (Parallel, cached). Costs $0.001 per URL that is not already cached.
  const captures = await extractPages(mappings.map((m) => m.url), { objective: OBJECTIVE, batchSize: 10, refresh: args.refresh, log: console.log });

  // 2. Prices (LLM, cached).
  const llm = isLlmConfigured();
  if (!llm) console.warn("\nANTHROPIC_API_KEY is not set: pages are fetched and cached, but prices cannot be parsed yet.\n");

  type Row = { i: number; mapping: Mapping; product?: typeof products[number]; capture: PageCapture; outcome?: ParseOutcome; error?: string };
  const rows: Row[] = [];
  let tokens = { input: 0, output: 0 };
  for (const [i, mapping] of mappings.entries()) {
    const product = productFor(mapping.key);
    const capture = captures[i];
    const row: Row = { i: i + 1, mapping, product, capture };
    if (!product) row.error = "A1 product not crawled";
    else if (capture.error) row.error = `extract: ${capture.error.error_type}${capture.error.http_status_code ? ` (HTTP ${capture.error.http_status_code})` : ""}`;
    else if (!capture.result?.full_content) row.error = "extract: empty page";
    else if (llm) {
      try {
        row.outcome = await parseListing(
          { retailer: mapping.retailer, url: mapping.url, a1Name: product.name ?? product.slug, a1Price: product.price, title: capture.result.title, markdown: capture.result.full_content, excerpts: capture.result.excerpts },
          { refresh: args.reparse },
        );
        if (row.outcome.usage && !row.outcome.cached) tokens = { input: tokens.input + row.outcome.usage.input, output: tokens.output + row.outcome.usage.output };
      } catch (err) {
        row.error = `parse: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    rows.push(row);
    console.log(`[${row.i}/${mappings.length}] ${mapping.retailer.padEnd(8)} ${row.error ?? (row.outcome ? `${gbp(row.outcome.parse.price)} ${row.outcome.cached ? "(cached)" : ""}` : "fetched")}  ${cut(product?.name, 50)}`);
  }

  // 3. Table.
  console.log("\n#  | A1 listing                               | A1 £    | Retailer | Price   | Was     | Deliv | Landed  | Stock        | Match (csv / page)  | Conf | Page title");
  console.log("---+------------------------------------------+---------+----------+---------+---------+-------+---------+--------------+---------------------+------+---------------------------");
  for (const r of rows) {
    const p = r.outcome?.parse;
    const landed = p?.price != null ? p.price + (p.delivery_cost ?? 0) : null;
    const pageMatch = p ? `${p.match}${p.match_note ? "*" : ""}` : r.error ? "ERR" : "?";
    console.log(
      [
        String(r.i).padEnd(2),
        cut(r.product?.name ?? r.mapping.key, 40).padEnd(40),
        gbp(r.product?.price).padStart(7),
        r.mapping.retailer.padEnd(8),
        gbp(p?.price).padStart(7),
        gbp(p?.was_price).padStart(7),
        (p?.delivery_cost == null ? "—" : p.delivery_cost === 0 ? "free" : gbp(p.delivery_cost)).padStart(5),
        gbp(landed).padStart(7),
        (p?.stock ?? (r.error ? "error" : "—")).padEnd(12),
        `${r.mapping.match} / ${pageMatch}`.padEnd(19),
        (p ? p.confidence.toFixed(2) : "—").padStart(4),
        cut(r.capture.result?.title ?? r.error, 60),
      ].join(" | "),
    );
  }
  console.log("\nNotes (* = page-level match note; ignored amounts show what the parser set aside):");
  for (const r of rows) {
    const p = r.outcome?.parse;
    const bits = [r.mapping.note && `csv: ${r.mapping.note}`, p?.match_note && `page: ${p.match_note}`, p?.price_evidence && `evidence: "${cut(p.price_evidence, 80)}"`, p?.ignored.length && `ignored: ${p.ignored.slice(0, 4).join("; ")}`, r.error].filter(Boolean);
    if (bits.length) console.log(`  ${r.i}. ${bits.join(" · ")}`);
  }
  if (tokens.input) console.log(`\nLLM usage this run: ${tokens.input.toLocaleString()} input / ${tokens.output.toLocaleString()} output tokens on ${rows.filter((r) => r.outcome && !r.outcome.cached).length} page(s).`);

  // 4. Import, only when asked.
  if (!args.import) {
    console.log("\nDry run: nothing written to the database. Re-run with --import to store these.");
    return;
  }
  let stored = 0;
  for (const r of rows) {
    if (!r.product || !r.capture.result) continue;
    const [capture] = await db
      .insert(schema.pageCaptures)
      .values({ url: r.mapping.url, source: "parallel", fetchedAt: new Date(r.capture.fetchedAt), title: r.capture.result.title, markdown: r.capture.result.full_content, meta: { extractId: r.capture.extractId, request: r.capture.request, publishDate: r.capture.result.publish_date } })
      .returning({ id: schema.pageCaptures.id });
    const p = r.outcome?.parse;
    // The CSV flag is ours; the page check can only make it worse, never better.
    const match = p ? (MATCH_RANK[p.match] > MATCH_RANK[r.mapping.match] ? p.match : r.mapping.match) : r.mapping.match;
    await db.insert(schema.competitorPrices).values({
      productId: r.product.id,
      source: "parallel",
      retailer: r.mapping.retailer,
      url: r.mapping.url,
      title: p?.product_title ?? r.capture.result.title,
      price: p?.price != null ? p.price + (p.delivery_cost ?? 0) : null,
      itemPrice: p?.price ?? null,
      shippingCost: p?.delivery_cost ?? null,
      wasPrice: p?.was_price ?? null,
      currency: "GBP",
      availability: p?.stock ?? "unknown",
      sellerType: "retailer",
      match,
      matchNote: [r.mapping.note, p?.match_note].filter(Boolean).join(" · ") || null,
      captureId: capture.id,
      status: r.error ? "error" : p?.price != null ? "ok" : "no_price",
      note: [r.error, r.outcome && `parsed by ${r.outcome.model} (confidence ${p!.confidence.toFixed(2)})`, p?.price_evidence && `evidence: ${p.price_evidence}`].filter(Boolean).join(" · ") || null,
      capturedAt: new Date(r.capture.fetchedAt),
    });
    stored++;
    await db.update(schema.competitorListings).set({ match, matchNote: r.mapping.note || null }).where(eq(schema.competitorListings.url, r.mapping.url));
  }
  console.log(`\nStored ${stored} capture(s) and price observation(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
