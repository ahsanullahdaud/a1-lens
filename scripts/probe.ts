/**
 * Can we crawl retailer X politely? Fetch a handful of their product pages
 * through PoliteFetcher and report what came back, stopping at the first
 * 401/403/429 for a host.
 *
 *   npm run probe -- --delay 5000 https://www.example.co.uk/product/1 https://www.example.co.uk/product/2
 *   npm run probe -- --file data/probe-currys.txt          # one URL per line, # comments allowed
 *
 * Nothing is stored; this is a yes/no about a retailer, not a price check.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as cheerio from "cheerio";
import { PoliteFetcher } from "../src/lib/crawler/http";
import { extractJsonLdProducts } from "../src/lib/jsonld";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    delay: { type: "string", default: "5000" },
    file: { type: "string" },
  },
});

/** Bot-challenge pages come back as HTTP 200; recognise them so they don't count as success. */
const CHALLENGE = /access denied|pardon our interruption|just a moment|are you a human|verify you are human|captcha|request unsuccessful|incapsula|unusual traffic|bot detection/i;

type Row = { host: string; url: string; outcome: string; http?: number; bytes?: number; title?: string; product?: string; price?: string; gtin?: string; note?: string };

async function main() {
  const urls = [
    ...positionals,
    ...(args.file ? readFileSync(args.file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : []),
  ];
  if (!urls.length) throw new Error("Give product URLs as arguments or with --file.");

  // No retries: a 429 means "not now", and the honest response is to stop, not knock again.
  const fetcher = new PoliteFetcher({ delayMs: Number(args.delay), maxRetries: 0 });
  const stoppedHosts = new Set<string>();
  const rows: Row[] = [];

  for (const url of urls) {
    const host = new URL(url).host;
    if (stoppedHosts.has(host)) {
      rows.push({ host, url, outcome: "skipped", note: "host already refused us" });
      continue;
    }
    const res = await fetcher.get(url);
    const row: Row = { host, url, outcome: res.status, http: res.httpStatus, note: res.note };

    if (res.status === "ok" && res.html) {
      row.bytes = res.html.length;
      const $ = cheerio.load(res.html);
      row.title = $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 70);
      const [product] = extractJsonLdProducts($);
      if (CHALLENGE.test(res.html) && !product) {
        row.outcome = "challenge";
        row.note = "HTTP 200 but the body is a bot challenge, not the page";
      } else if (product) {
        row.product = product.name?.slice(0, 60);
        row.price = product.offer?.price != null ? `${product.offer.currency ?? ""} ${product.offer.price}` : "no offer";
        row.gtin = product.gtin;
      } else {
        row.note = "HTML received but no schema.org Product markup";
      }
    }
    if (res.status === "blocked") stoppedHosts.add(host);
    rows.push(row);
    console.log(format(row));
  }

  console.log("\nSummary");
  for (const host of new Set(rows.map((r) => r.host))) {
    const mine = rows.filter((r) => r.host === host);
    const attempted = mine.filter((r) => r.outcome !== "skipped");
    const usable = mine.filter((r) => r.product);
    const counts = [...new Set(attempted.map((r) => r.outcome))].map((o) => `${o} ×${attempted.filter((r) => r.outcome === o).length}`).join(", ");
    console.log(`  ${host}: ${attempted.length} attempted, ${usable.length} with product markup (${attempted.length ? Math.round((usable.length / attempted.length) * 100) : 0}%) — ${counts}${stoppedHosts.has(host) ? " — stopped at first refusal" : ""}`);
  }
}

function format(r: Row): string {
  const head = `${r.outcome.toUpperCase().padEnd(10)} ${r.http ?? "-"}  ${r.url}`;
  const details = [
    r.bytes != null ? `${Math.round(r.bytes / 1024)} KB` : "",
    r.title ? `title: ${r.title}` : "",
    r.product ? `product: ${r.product}` : "",
    r.price ? `price: ${r.price}` : "",
    r.gtin ? `gtin: ${r.gtin}` : "",
    r.note ?? "",
  ].filter(Boolean);
  return details.length ? `${head}\n           ${details.join(" · ")}` : head;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
