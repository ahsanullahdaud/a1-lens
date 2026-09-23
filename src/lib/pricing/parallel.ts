import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parallel Extract API (https://docs.parallel.ai/extract): turns a public URL
 * into markdown, including JS-heavy pages that refuse ordinary crawlers.
 * Every response is cached on disk, so re-running a parse costs nothing and
 * the raw page is kept for audit.
 */

const ENDPOINT = "https://api.parallel.ai/v1/extract";
const CACHE_DIR = join("data", "cache", "parallel");
/** Parallel's own index may serve stale copies; 600 s is the minimum it accepts, i.e. "fetch it now". */
const MAX_AGE_SECONDS = 600;

export type ExtractResult = { url: string; title: string | null; publish_date: string | null; excerpts: string[]; full_content: string | null };
export type ExtractError = { url: string; error_type: string; http_status_code: number | null; content: string | null };
type ExtractResponse = {
  extract_id: string;
  results: ExtractResult[];
  errors: ExtractError[];
  warnings: unknown[] | null;
  usage: { name: string; count: number }[] | null;
  session_id: string;
};

/** What the cache holds for one URL. `fetchedAt` is when we asked, in ISO form. */
export type PageCapture = {
  url: string;
  source: "parallel";
  fetchedAt: string;
  extractId: string;
  request: { objective: string; maxAgeSeconds: number };
  result?: ExtractResult;
  error?: ExtractError;
};

const cachePath = (url: string) => join(CACHE_DIR, `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);

export function readCapture(url: string): PageCapture | undefined {
  const path = cachePath(url);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as PageCapture) : undefined;
}

export type ExtractOptions = {
  objective: string;
  batchSize?: number;
  /** Re-fetch even when a cached capture exists. */
  refresh?: boolean;
  log?: (line: string) => void;
};

/** Fetch each URL through Parallel (cache first), returning one capture per URL in input order. */
export async function extractPages(urls: string[], opts: ExtractOptions): Promise<PageCapture[]> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) throw new Error("PARALLEL_API_KEY is not set in .env");
  mkdirSync(CACHE_DIR, { recursive: true });

  const log = opts.log ?? (() => {});
  const captures = new Map<string, PageCapture>();
  const toFetch: string[] = [];
  for (const url of urls) {
    const cached = opts.refresh ? undefined : readCapture(url);
    if (cached) captures.set(url, cached);
    else if (!toFetch.includes(url)) toFetch.push(url);
  }
  log(`${captures.size} cached, ${toFetch.length} to fetch`);

  const batchSize = opts.batchSize ?? 10;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const fetchedAt = new Date().toISOString();
    log(`Parallel Extract: batch ${i / batchSize + 1} (${batch.length} URLs)…`);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        urls: batch,
        objective: opts.objective,
        advanced_settings: { full_content: true, fetch_policy: { max_age_seconds: MAX_AGE_SECONDS } },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Parallel Extract HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const body = (await res.json()) as ExtractResponse;

    const base = { source: "parallel" as const, fetchedAt, extractId: body.extract_id, request: { objective: opts.objective, maxAgeSeconds: MAX_AGE_SECONDS } };
    for (const result of body.results) captures.set(result.url, { url: result.url, ...base, result });
    for (const error of body.errors) captures.set(error.url, { url: error.url, ...base, error });
    for (const url of batch) {
      const capture = captures.get(url) ?? { url, ...base, error: { url, error_type: "missing_from_response", http_status_code: null, content: null } };
      captures.set(url, capture);
      writeFileSync(cachePath(url), JSON.stringify(capture, null, 2));
    }
    log(`  ${body.results.length} ok, ${body.errors.length} failed, usage ${JSON.stringify(body.usage ?? [])}`);
  }

  return urls.map((url) => captures.get(url)!);
}
