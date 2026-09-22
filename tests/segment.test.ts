import { describe, expect, it } from "vitest";
import { classifySegment } from "../src/lib/audit/segment";
import { parseProductPage } from "../src/lib/crawler/parse-product";
import { baseJsonLd, FIXTURE_URL, productPage } from "./fixtures/product-page";

type PageOptions = Parameters<typeof productPage>[0];
const segmentOf = (options: PageOptions) => classifySegment(parseProductPage(productPage(options), FIXTURE_URL));

describe("classifySegment", () => {
  it("calls a fully described listing standard", () => {
    expect(segmentOf({})).toBe("standard");
  });

  it("recognises the distributor-feed signature: brand/EAN specs, one-line description, one image", () => {
    const thin: PageOptions = {
      specs: [["Brand", "Acme"], ["EAN", "4006381333931"]],
      description: "Acme Soundbar 300, black.",
      thumbs: 1,
      jsonLd: { ...baseJsonLd, description: "Acme Soundbar 300, black.", image: ["https://cdn.example/1.jpg"] },
    };
    expect(segmentOf(thin)).toBe("thin-feed");
    // Two of the three signals is not enough: a real description makes it standard.
    const described = { ...thin, description: "x".repeat(400), jsonLd: { ...thin.jsonLd, description: "x".repeat(400) } };
    expect(segmentOf(described)).toBe("standard");
  });

  it("separates listings that have images but no copy at all", () => {
    expect(segmentOf({ specs: [], description: "", thumbs: 8, jsonLd: { ...baseJsonLd, description: "" } })).toBe("no-copy");
  });
});
