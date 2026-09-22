/**
 * Crawl A1 product pages from the public sitemap, store a snapshot, audit it.
 *
 *   npm run crawl                    # 25 pages: never-crawled first, then the stalest
 *   npm run crawl -- --limit 100
 *   npm run crawl -- --all           # whole catalogue (~1000 pages ≈ 35 min at 2 s/page)
 *   npm run crawl -- --known         # re-crawl only pages already stored (after a parser change)
 *   npm run crawl -- --url https://a1techdeals.com/product/some-slug
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { PoliteFetcher } from "../src/lib/crawler/http";
import { parseProductPage } from "../src/lib/crawler/parse-product";
import { fetchProductUrls, type SitemapEntry } from "../src/lib/crawler/sitemap";
import { saveAudit, saveCrawledProduct } from "../src/lib/store";

const SITEMAP_URL = "https://a1techdeals.com/sitemap.xml";

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "25" },
    all: { type: "boolean", default: false },
    known: { type: "boolean", default: false },
    url: { type: "string" },
  },
});

async function main() {
  const fetcher = new PoliteFetcher();

  let queue: SitemapEntry[];
  if (args.url) {
    queue = [{ url: args.url }];
  } else {
    const entries = await fetchProductUrls(fetcher, SITEMAP_URL);
    console.log(`Sitemap lists ${entries.length} product pages.`);

    // Never-crawled pages first, then whichever we looked at longest ago.
    const known = await db.select({ url: schema.products.url, at: schema.products.lastCrawledAt }).from(schema.products);
    const lastCrawled = new Map(known.map((k) => [k.url, k.at?.getTime() ?? 0]));
    entries.sort((a, b) => (lastCrawled.get(a.url) ?? 0) - (lastCrawled.get(b.url) ?? 0));
    const pool = args.known ? entries.filter((e) => lastCrawled.has(e.url)) : entries;
    queue = args.all || args.known ? pool : pool.slice(0, Number(args.limit));
  }

  const [run] = await db.insert(schema.crawlRuns).values({ urlsPlanned: queue.length }).returning();
  let fetched = 0;
  let failed = 0;

  for (const [i, entry] of queue.entries()) {
    const res = await fetcher.get(entry.url);
    const label = `[${i + 1}/${queue.length}]`;
    if (res.status !== "ok" || !res.html) {
      failed++;
      console.warn(`${label} ${res.status.toUpperCase()} ${entry.url} ${res.note ?? ""}`);
      if (res.status === "blocked") {
        console.error("The site is refusing automated requests. Stopping instead of pushing on.");
        break;
      }
      continue;
    }
    const parsed = parseProductPage(res.html, entry.url);
    const productId = await saveCrawledProduct(parsed, res.httpStatus ?? 200, entry.lastmod);
    const { score, findings } = await saveAudit(productId, parsed);
    fetched++;
    console.log(`${label} score ${String(score).padStart(3)}  ${findings.length} finding(s)  ${parsed.slug}`);
  }

  await db
    .update(schema.crawlRuns)
    .set({ finishedAt: new Date(), pagesFetched: fetched, pagesFailed: failed })
    .where(eq(schema.crawlRuns.id, run.id));
  console.log(`\nDone: ${fetched} crawled, ${failed} failed. Open http://localhost:3000 after \`npm run dev\`.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
