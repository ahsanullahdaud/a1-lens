import { describe, expect, it } from "vitest";
import { parseRobots } from "../src/lib/crawler/robots";
import { parseSitemap } from "../src/lib/crawler/sitemap";
import { readOfferFromHtml } from "../src/lib/pricing/url-source";

const UA = "A1LensBot/0.1 (personal learning project)";

describe("parseRobots", () => {
  const robots = `
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /checkout
Disallow: /*?sort=
Disallow: /private$
Crawl-delay: 3

User-agent: BadBot
Disallow: /
`;
  const policy = parseRobots(robots, UA);

  it("allows product pages and blocks disallowed prefixes", () => {
    expect(policy.isAllowed("/product/some-slug")).toBe(true);
    expect(policy.isAllowed("/api/products")).toBe(false);
    expect(policy.isAllowed("/checkout/step-1")).toBe(false);
  });

  it("supports * wildcards and $ anchors", () => {
    expect(policy.isAllowed("/category/audio?sort=price")).toBe(false);
    expect(policy.isAllowed("/private")).toBe(false);
    expect(policy.isAllowed("/private-sale")).toBe(true);
  });

  it("reads Crawl-delay", () => expect(policy.crawlDelayMs).toBe(3000));

  it("prefers a group that names our bot over the * group", () => {
    const named = parseRobots("User-agent: *\nDisallow:\n\nUser-agent: a1lensbot\nDisallow: /", UA);
    expect(named.isAllowed("/product/x")).toBe(false);
  });

  it("treats an empty file as allow-all", () => expect(parseRobots("", UA).isAllowed("/anything")).toBe(true));
});

describe("parseSitemap", () => {
  it("reads urls, lastmod and nested sitemaps", () => {
    const xml = `<sitemapindex><sitemap><loc>https://x.test/products.xml</loc></sitemap></sitemapindex>
      <urlset><url><loc>https://x.test/product/a?b=1&amp;c=2</loc><lastmod>2026-09-21T16:04:30.083Z</lastmod></url></urlset>`;
    const { entries, childSitemaps } = parseSitemap(xml);
    expect(childSitemaps).toEqual(["https://x.test/products.xml"]);
    expect(entries[0].url).toBe("https://x.test/product/a?b=1&c=2");
    expect(entries[0].lastmod?.toISOString()).toBe("2026-09-21T16:04:30.083Z");
  });
});

describe("readOfferFromHtml", () => {
  it("takes the cheapest offer from a competitor page", () => {
    const ld = { "@type": "Product", name: "Thing", offers: [{ price: "120.00", priceCurrency: "GBP" }, { price: "99.50", priceCurrency: "GBP", availability: "https://schema.org/OutOfStock" }] };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(readOfferFromHtml(html)).toMatchObject({ title: "Thing", price: 99.5, currency: "GBP", availability: "out_of_stock" });
  });

  it("handles AggregateOffer.lowPrice and pages without markup", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", offers: { "@type": "AggregateOffer", lowPrice: 45, priceCurrency: "GBP" } })}</script>`;
    expect(readOfferFromHtml(html)?.price).toBe(45);
    expect(readOfferFromHtml("<html></html>")).toBeNull();
  });
});
