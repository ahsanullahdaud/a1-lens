import type { PoliteFetcher } from "./http";

export type SitemapEntry = { url: string; lastmod?: Date };

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseSitemap(xml: string): { entries: SitemapEntry[]; childSitemaps: string[] } {
  const entries: SitemapEntry[] = [];
  const childSitemaps: string[] = [];

  for (const [, block] of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (loc) childSitemaps.push(decode(loc));
  }
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1];
    const date = lastmod ? new Date(lastmod) : undefined;
    entries.push({ url: decode(loc), lastmod: date && !Number.isNaN(date.getTime()) ? date : undefined });
  }
  return { entries, childSitemaps };
}

/** Fetch a sitemap (following one level of sitemap-index nesting) and keep product pages. */
export async function fetchProductUrls(fetcher: PoliteFetcher, sitemapUrl: string): Promise<SitemapEntry[]> {
  const root = await fetcher.get(sitemapUrl);
  if (root.status !== "ok" || !root.html) {
    throw new Error(`Could not fetch sitemap ${sitemapUrl}: ${root.status} ${root.note ?? ""}`);
  }
  const { entries, childSitemaps } = parseSitemap(root.html);
  for (const child of childSitemaps) {
    const res = await fetcher.get(child);
    if (res.status === "ok" && res.html) entries.push(...parseSitemap(res.html).entries);
  }
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (!new URL(e.url).pathname.startsWith("/product/") || seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
}
