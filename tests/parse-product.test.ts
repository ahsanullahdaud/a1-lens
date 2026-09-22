import { describe, expect, it } from "vitest";
import { parsePrice, parseProductPage } from "../src/lib/crawler/parse-product";
import { FIXTURE_URL, productPage } from "./fixtures/product-page";

describe("parseProductPage", () => {
  const parsed = parseProductPage(productPage(), FIXTURE_URL);

  it("reads the head", () => {
    expect(parsed.slug).toBe("acme-soundbar-300");
    expect(parsed.titleTag).toBe("Acme Soundbar 300 | A1 Tech Deals");
    expect(parsed.canonical).toBe(FIXTURE_URL);
    expect(parsed.metaDescription).toContain("free UK delivery");
  });

  it("reads the Product JSON-LD", () => {
    expect(parsed.jsonLdProductCount).toBe(1);
    expect(parsed.jsonLd).toMatchObject({ sku: "A1T-TEST000001", gtin: "4006381333931", brand: "Acme" });
    expect(parsed.jsonLd?.offer).toMatchObject({ price: 199.99, currency: "GBP", availability: "in_stock", condition: "new" });
    expect(parsed.jsonLd?.images).toHaveLength(3);
  });

  it("reads the visible buy box", () => {
    expect(parsed.h1Count).toBe(1);
    expect(parsed.visiblePrice).toBe(199.99);
    expect(parsed.visibleWasPrice).toBe(249.99);
    expect(parsed.conditionLabel).toBe("Brand New");
    expect(parsed.breadcrumbs).toEqual(["Audio", "Soundbars"]);
  });

  it("reads specs and gallery", () => {
    expect(parsed.specs).toContainEqual({ label: "Power Output", value: "300 W" });
    expect(parsed.galleryImageCount).toBe(3);
    expect(parsed.imagesMissingAlt).toBe(0);
  });

  it("finds Product nodes nested in @graph", () => {
    const html = productPage({ jsonLd: { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": ["Product"], name: "Nested", offers: { price: 10 } }] } });
    expect(parseProductPage(html, FIXTURE_URL).jsonLd).toMatchObject({ name: "Nested", offer: { price: 10 } });
  });

  it("reads condition tabs, including price, stock and which one is selected", () => {
    const html = productPage({ conditionTabs: [["new", "Brand NewOut of stock", false], ["grade-a", "Refurbished – Excellent£1,295.99", true]] });
    expect(parseProductPage(html, FIXTURE_URL).conditionVariants).toEqual([
      { id: "new", label: "Brand New", price: undefined, outOfStock: true, selected: false },
      { id: "grade-a", label: "Refurbished – Excellent", price: 1295.99, outOfStock: false, selected: true },
    ]);
  });

  it("survives a page with no JSON-LD at all", () => {
    const bare = parseProductPage(productPage({ jsonLd: null }), FIXTURE_URL);
    expect(bare.jsonLd).toBeUndefined();
    expect(bare.visiblePrice).toBe(199.99);
  });
});

describe("parsePrice", () => {
  it.each([
    ["£1,299.00", 1299],
    ["£112.49", 112.49],
    ["From £89", 89],
    ["", undefined],
  ])("%s -> %s", (input, expected) => expect(parsePrice(input)).toBe(expected));
});
