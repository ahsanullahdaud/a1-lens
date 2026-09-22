import * as cheerio from "cheerio";
import { extractJsonLdProducts, type JsonLdProduct } from "../jsonld";

/**
 * Everything the auditor needs from one A1 product page, as plain JSON so it
 * can be stored in `products.snapshot` and re-audited without re-crawling.
 *
 * Selectors lean on the site's `data-testid` hooks (pdp-price-block, pdp-specs…)
 * because they survive restyling far better than Tailwind class names do.
 */
export type ParsedProduct = {
  url: string;
  slug: string;

  // <head>
  titleTag?: string;
  metaDescription?: string;
  canonical?: string;
  ogImage?: string;
  robotsMeta?: string;

  // structured data
  jsonLd?: JsonLdProduct;
  jsonLdProductCount: number;

  // visible page
  h1?: string;
  h1Count: number;
  breadcrumbs: string[];
  visiblePrice?: number;
  visibleWasPrice?: number;
  /** The "email me when it's back" form is showing instead of Add to Cart. */
  outOfStockNotice?: boolean;
  conditionLabel?: string;
  conditionNotes?: string;
  /** Tabs of the condition selector; empty when the product has a single condition. */
  conditionVariants: ConditionVariant[];
  description?: string;
  specs: { label: string; value: string }[];
  galleryImageCount: number;
  imagesMissingAlt: number;
};

export type ConditionVariant = {
  /** From the tab's test id: "new", "grade-a", "grade-b", "grade-c"… */
  id: string;
  label: string;
  price?: number;
  outOfStock: boolean;
  selected: boolean;
};

const PRICE = /£\s?[\d,]+(?:\.\d{1,2})?/;

const clean = (s?: string | null) => s?.replace(/\s+/g, " ").trim() || undefined;

export function parsePrice(text?: string): number | undefined {
  const match = text?.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : undefined;
}

export function parseProductPage(html: string, url: string): ParsedProduct {
  const $ = cheerio.load(html);
  const byTestId = (id: string) => $(`[data-testid="${id}"]`).first();

  const jsonLdProducts = extractJsonLdProducts($);

  // Breadcrumb trail minus "Home" and the product's own name = the category path.
  const crumbs = byTestId("breadcrumb-trail")
    .find("a, span, li")
    .map((_, el) => ($(el).children().length === 0 ? clean($(el).text()) : undefined))
    .get()
    .filter((c): c is string => Boolean(c) && !/^[>/›·]$/.test(c));
  const categoryTrail = clean(byTestId("pdp-category-trail").text())?.replace(/^Category:\s*/i, "");
  const breadcrumbs = categoryTrail
    ? categoryTrail.split(">").map((c) => c.trim()).filter(Boolean)
    : crumbs.slice(1, -1);

  const specs = byTestId("pdp-specs")
    .find("dt")
    .map((_, dt) => ({
      label: clean($(dt).text())?.replace(/:$/, "") ?? "",
      value: clean($(dt).next("dd").text()) ?? "",
    }))
    .get()
    .filter((row) => row.label);

  const conditionVariants = $('[data-testid^="condition-tab-"]')
    .map((_, el): ConditionVariant => {
      const text = clean($(el).text()) ?? "";
      return {
        id: ($(el).attr("data-testid") ?? "").replace("condition-tab-", ""),
        label: clean(text.replace(PRICE, "").replace(/out of stock/i, "")) ?? "",
        price: parsePrice(text.match(PRICE)?.[0]),
        outOfStock: /out of stock/i.test(text),
        // The tabs are role="radio"; tolerate a switch to role="tab" later.
        selected: $(el).attr("aria-checked") === "true" || $(el).attr("aria-selected") === "true",
      };
    })
    .get();

  const priceBlock = byTestId("pdp-price-block");
  const gallery = byTestId("image-gallery");
  const thumbs = $('[data-testid="image-gallery-thumb"]').length;

  return {
    url,
    slug: new URL(url).pathname.replace(/^\/product\//, "").replace(/\/$/, ""),

    titleTag: clean($("title").first().text()),
    metaDescription: clean($('meta[name="description"]').attr("content")),
    canonical: clean($('link[rel="canonical"]').attr("href")),
    ogImage: clean($('meta[property="og:image"]').attr("content")),
    robotsMeta: clean($('meta[name="robots"]').attr("content")),

    jsonLd: jsonLdProducts[0],
    jsonLdProductCount: jsonLdProducts.length,

    h1: clean($("h1").first().text()),
    h1Count: $("h1").length,
    breadcrumbs,
    // Out-of-stock pages keep the price block but drop the `condition-price` hook.
    visiblePrice: parsePrice(byTestId("condition-price").text()) ?? parsePrice(priceBlock.text()),
    outOfStockNotice: $('[data-testid="back-in-stock-form"]').length > 0,
    visibleWasPrice: parsePrice(priceBlock.find(".line-through").first().text()),
    conditionLabel: clean(byTestId("sticky-atc-condition-chip").text()) ?? clean(byTestId("condition-trust-badge-top").text()),
    conditionNotes: clean(byTestId("condition-details-notes").text()),
    conditionVariants,
    description: clean(byTestId("pdp-description").text())?.replace(/^Description\s+/i, ""),
    specs,
    // Thumbnails are the honest count; the gallery itself renders each image twice.
    galleryImageCount: thumbs || gallery.find("img").length,
    imagesMissingAlt: gallery.find("img").filter((_, img) => !clean($(img).attr("alt"))).length,
  };
}
