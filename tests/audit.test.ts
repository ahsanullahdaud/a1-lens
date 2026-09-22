import { describe, expect, it } from "vitest";
import { auditProduct } from "../src/lib/audit";
import { isValidGtin } from "../src/lib/audit/gtin";
import { slugConditionWord } from "../src/lib/audit/rules";
import { parseProductPage } from "../src/lib/crawler/parse-product";
import { baseJsonLd, FIXTURE_URL, productPage } from "./fixtures/product-page";

const NOW = new Date("2026-09-21T00:00:00Z");
type PageOptions = Parameters<typeof productPage>[0];

const ruleIds = (options: PageOptions = {}, url = FIXTURE_URL) =>
  auditProduct(parseProductPage(productPage(options), url), NOW).findings.map((f) => f.ruleId);

const withOffer = (offer: Record<string, unknown>) => ({ ...baseJsonLd, offers: { ...baseJsonLd.offers, ...offer } });

describe("auditProduct", () => {
  it("a well-formed listing only trips the markup-enrichment rules", () => {
    expect(ruleIds().sort()).toEqual(["jsonld-no-return-policy", "jsonld-no-shipping-details"]);
  });

  it("scores 100 minus the weighted findings", () => {
    const { score } = auditProduct(parseProductPage(productPage(), FIXTURE_URL), NOW);
    expect(score).toBe(100 - 3 - 3);
  });

  it("flags a JSON-LD price that differs from the buy box", () => {
    expect(ruleIds({ visiblePrice: "£209.99" })).toContain("price-mismatch");
  });

  describe("condition variants", () => {
    // Modelled on a real listing: JSON-LD carried the "Fair" price, the page opened on "Excellent".
    const refurb = {
      jsonLd: withOffer({ price: "284.99", itemCondition: "https://schema.org/RefurbishedCondition" }),
      visiblePrice: "£295.99",
      conditionChip: "Refurbished – Excellent",
      conditionNotes: "Faint marks only.",
    };
    const tabs = (good: string): [string, string, boolean][] => [
      ["new", "Brand NewOut of stock", false],
      ["grade-a", "Refurbished – Excellent£295.99", true],
      ["grade-b", `Refurbished – Good${good}`, false],
      ["grade-c", "Refurbished – Fair£284.99", false],
    ];

    it("treats a JSON-LD price from another tab as a variant issue, not a hard mismatch", () => {
      const ids = ruleIds({ ...refurb, conditionTabs: tabs("£289.00") });
      expect(ids).toContain("jsonld-price-is-other-variant");
      expect(ids).not.toContain("price-mismatch");
      expect(ids).not.toContain("grade-price-inversion");
    });

    it("flags a worse grade priced above a better one", () => {
      const { findings } = auditProduct(parseProductPage(productPage({ ...refurb, conditionTabs: tabs("£315.49") }), FIXTURE_URL), NOW);
      const inversion = findings.find((f) => f.ruleId === "grade-price-inversion");
      expect(inversion?.message).toBe("Refurbished – Good is £315.49 but Refurbished – Excellent is only £295.99.");
    });

    it("does not call a Brand New page mislabelled when JSON-LD merely describes the cheapest tab", () => {
      // Real pattern: 21 listings open on Brand New while the Offer carries the Grade C price and RefurbishedCondition.
      const ids = ruleIds({
        jsonLd: withOffer({ price: "284.99", itemCondition: "https://schema.org/RefurbishedCondition" }),
        visiblePrice: "£567.44",
        conditionChip: "Brand New",
        conditionTabs: [["new", "Brand New£567.44", true], ["grade-a", "Refurbished – Excellent£295.99", false], ["grade-c", "Refurbished – Fair£284.99", false]],
      });
      expect(ids).toContain("jsonld-price-is-other-variant");
      expect(ids).not.toContain("condition-mismatch");
      expect(ids).not.toContain("refurb-condition-unexplained");
      expect(ids).not.toContain("refurb-accessories-unstated");
    });

    it("treats Open Box like a refurbished grade for the accessories rule, never as a condition mismatch", () => {
      const ids = ruleIds({
        jsonLd: withOffer({ itemCondition: "https://schema.org/NewCondition" }),
        conditionChip: "Open Box",
        conditionNotes: "Box opened, contents unused.",
        specs: [["Brand", "Acme"], ["Channels", "3.1"], ["Power", "300 W"], ["HDMI", "eARC"], ["Plug Type", "UK 3-pin plug"]],
      });
      expect(ids).toContain("refurb-accessories-unstated");
      expect(ids).not.toContain("condition-mismatch");
    });

    it("ignores out-of-stock variants when comparing grades", () => {
      const conditionTabs: [string, string, boolean][] = [["grade-a", "Refurbished – Excellent£295.99", true], ["grade-b", "Refurbished – Good£315.49Out of stock", false]];
      expect(ruleIds({ ...refurb, jsonLd: withOffer({ price: "295.99", itemCondition: "https://schema.org/RefurbishedCondition" }), conditionTabs })).not.toContain("grade-price-inversion");
    });
  });

  it("flags refurbished stock marked up as new", () => {
    const ids = ruleIds({ conditionChip: "Refurbished – Excellent", conditionNotes: "Faint marks only." });
    expect(ids).toContain("condition-mismatch");
  });

  it("flags a refurbished listing with no condition report or accessories statement", () => {
    const ids = ruleIds({
      jsonLd: withOffer({ itemCondition: "https://schema.org/RefurbishedCondition" }),
      conditionChip: "Refurbished – Good",
      specs: [["Brand", "Acme"], ["Channels", "3.1"], ["Power", "300 W"], ["HDMI", "eARC"], ["Plug Type", "UK 3-pin plug"]],
    });
    expect(ids).toEqual(expect.arrayContaining(["refurb-condition-unexplained", "refurb-accessories-unstated"]));
    expect(ids).not.toContain("box-contents-unstated");
  });

  it("flags a slug that promises a different grade", () => {
    const url = "https://a1techdeals.com/product/acme-refurbished-phone-very-good-condition";
    const options = { conditionChip: "Refurbished – Excellent", conditionNotes: "Faint marks only.", jsonLd: withOffer({ itemCondition: "https://schema.org/RefurbishedCondition" }) };
    expect(ruleIds(options, url)).toContain("slug-condition-mismatch");
    expect(ruleIds({ ...options, conditionChip: "Refurbished – Very Good" }, url)).not.toContain("slug-condition-mismatch");
  });

  it("flags a mains-powered product with no plug statement — and ignores review text", () => {
    const specs: [string, string][] = [["Brand", "Acme"], ["Channels", "3.1"], ["Power", "300 W"], ["HDMI", "eARC"], ["In the box", "Soundbar, remote"]];
    // The fixture's review section mentions a "European plug"; that must not count.
    expect(ruleIds({ specs })).toContain("plug-type-unstated");
    expect(ruleIds()).not.toContain("plug-type-unstated");
  });

  it("does not ask a memory module or keyboard for a plug type", () => {
    for (const name of ["Crucial CT16G4SFRA32AT Laptop Memory Module 16 GB", "HP Desktop 320K - keyboard - Belgium"]) {
      const ids = ruleIds({ jsonLd: { ...baseJsonLd, name }, specs: [["Brand", "Acme"], ["EAN", "4006381333931"]] });
      expect(ids).not.toContain("plug-type-unstated");
    }
  });

  it("flags thin content", () => {
    const ids = ruleIds({ description: "Short.", jsonLd: { ...baseJsonLd, description: "Short." }, specs: [["Brand", "Acme"]], thumbs: 1 });
    expect(ids).toEqual(expect.arrayContaining(["description-short", "specs-thin"]));
  });

  it("flags SEO template problems", () => {
    const ids = ruleIds({ metaDescription: "z".repeat(900), canonical: "https://a1techdeals.com/product/other", extraH1: true });
    expect(ids).toEqual(expect.arrayContaining(["meta-description-long", "canonical-mismatch", "h1-count"]));
  });

  it("flags an out-of-stock page that drops its Offer, and still reads the price", () => {
    const noOffer = Object.fromEntries(Object.entries(baseJsonLd).filter(([key]) => key !== "offers"));
    const parsed = parseProductPage(productPage({ jsonLd: noOffer, outOfStock: true, visiblePrice: "£91.99" }), FIXTURE_URL);
    expect(parsed).toMatchObject({ visiblePrice: 91.99, outOfStockNotice: true });
    const finding = auditProduct(parsed, NOW).findings.find((f) => f.ruleId === "jsonld-offer-missing");
    expect(finding?.message).toBe("Out-of-stock page publishes no Offer at all.");
  });

  it("flags missing, invalid and expired structured data", () => {
    expect(ruleIds({ jsonLd: null })).toContain("jsonld-missing");
    expect(ruleIds({ jsonLd: { ...baseJsonLd, gtin13: "4006381333932" } })).toContain("gtin-invalid");
    expect(ruleIds({ jsonLd: withOffer({ priceValidUntil: "2026-01-01" }) })).toContain("price-valid-until-expired");
  });
});

describe("helpers", () => {
  it("validates GTIN check digits", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("0840440406815")).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
  });

  it("only reads grade words from slugs that are about condition", () => {
    expect(slugConditionWord("apple-refurbished-iphone-12-very-good-condition")).toBe("very-good");
    expect(slugConditionWord("feel-good-bluetooth-speaker")).toBeUndefined();
  });
});
