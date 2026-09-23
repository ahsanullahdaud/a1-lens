import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../src/db/schema";
import { EbaySource, exclusionReason, shippingCost, type EbayItem } from "../src/lib/pricing/ebay-source";

const product = { id: 1, gtin: "1200130019302", price: 81.99, condition: "new", name: "JBL Flip 7 Bluetooth Speaker White" } as Product;

const item = (overrides: Partial<EbayItem> & { price: number; shipping?: number; type?: "BUSINESS" | "INDIVIDUAL" }): EbayItem => ({
  itemId: `v1|${overrides.price}|0`,
  title: overrides.title ?? "JBL Flip 7 Portable Bluetooth Speaker - White",
  itemWebUrl: `https://www.ebay.co.uk/itm/${overrides.price}`,
  condition: "New",
  price: { value: overrides.price.toFixed(2), currency: "GBP" },
  shippingOptions: overrides.shipping == null ? [] : [{ shippingCost: { value: overrides.shipping.toFixed(2), currency: "GBP" } }],
  seller: { username: `seller${overrides.price}`, feedbackPercentage: "99.5", feedbackScore: 1200, sellerAccountType: overrides.type ?? "BUSINESS" },
  itemLocation: { country: "GB" },
});

/** Answers the token request, then serves `items` to the search request and records its URL. */
function mockEbay(items: EbayItem[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 7200 }));
      return new Response(JSON.stringify({ itemSummaries: items }));
    }),
  );
  return calls;
}

describe("EbaySource", () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = "id";
    process.env.EBAY_CLIENT_SECRET = "secret";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for UK-located, buy-it-now, same-condition listings with postage to the UK", async () => {
    const calls = mockEbay([item({ price: 70, shipping: 4.99 })]);
    await new EbaySource().lookup(product);
    const search = new URL(calls[1]);
    expect(search.searchParams.get("gtin")).toBe("1200130019302");
    expect(search.searchParams.get("filter")).toBe("buyingOptions:{FIXED_PRICE},itemLocationCountry:GB,deliveryCountry:GB,conditions:{NEW}");
  });

  it("prefers a business seller, includes postage in the price and keeps condition + seller type", async () => {
    mockEbay([item({ price: 65, shipping: 0, type: "INDIVIDUAL" }), item({ price: 70, shipping: 4.99, type: "BUSINESS" })]);
    const [o] = await new EbaySource().lookup(product);
    expect(o).toMatchObject({ status: "ok", price: 74.99, itemPrice: 70, shippingCost: 4.99, condition: "New", sellerType: "business", seller: "seller70" });
    expect(o.note).toContain("individual seller cheaper at £65.00");
  });

  it("prefers an exact-variant listing over a cheaper near-match and records the match", async () => {
    mockEbay([item({ price: 60, title: "JBL Flip 7 Portable Bluetooth Speaker - Black" }), item({ price: 72, title: "JBL Flip 7 Portable Bluetooth Speaker - White" })]);
    const [o] = await new EbaySource().lookup(product);
    expect(o).toMatchObject({ status: "ok", price: 72, match: "exact" });
    expect(o.note).toContain("a near match is cheaper at £60.00 (colour: listing says black, A1 says white)");
  });

  it("records a near-match as such when nothing exact is listed", async () => {
    mockEbay([item({ price: 60, title: "JBL Flip 7 Portable Bluetooth Speaker - Black" })]);
    const [o] = await new EbaySource().lookup(product);
    expect(o).toMatchObject({ status: "ok", price: 60, match: "near", matchNote: "colour: listing says black, A1 says white" });
  });

  it("falls back to an individual seller when no business seller is listed", async () => {
    mockEbay([item({ price: 65, type: "INDIVIDUAL" })]);
    const [o] = await new EbaySource().lookup(product);
    expect(o).toMatchObject({ status: "ok", price: 65, sellerType: "individual" });
  });

  it("skips faulty, accessory and implausibly cheap listings", async () => {
    mockEbay([
      item({ price: 5, title: "Carry Case for JBL Flip 7 Speaker" }),
      item({ price: 30, title: "JBL Flip 7 - FAULTY - spares or repair" }),
      item({ price: 12, title: "JBL Flip 7 Bluetooth Speaker White" }), // too cheap to be real
      item({ price: 72, shipping: 3 }),
    ]);
    const [o] = await new EbaySource().lookup(product);
    expect(o).toMatchObject({ status: "ok", price: 75 });
    expect(o.note).toContain("skipped accessory (case), faulty/parts, too cheap to be the product");
  });

  it("uses refurbished conditions for a refurbished A1 listing", async () => {
    const calls = mockEbay([item({ price: 150 })]);
    await new EbaySource().lookup({ ...product, condition: "refurbished" } as Product);
    expect(new URL(calls[1]).searchParams.get("filter")).toContain("conditions:{CERTIFIED_REFURBISHED|EXCELLENT_REFURBISHED|VERY_GOOD_REFURBISHED|GOOD_REFURBISHED|SELLER_REFURBISHED}");
  });

  it("records not_found when nothing comparable is listed", async () => {
    mockEbay([]);
    expect((await new EbaySource().lookup(product))[0]).toMatchObject({ status: "not_found" });
    mockEbay([item({ price: 5, title: "Silicone cover for JBL Flip 7" })]);
    const [o] = await new EbaySource().lookup(product);
    expect(o.status).toBe("not_found");
    expect(o.note).toContain("none comparable");
  });

  it("skips products without a GTIN and reports API failures as errors", async () => {
    expect(await new EbaySource().lookup({ ...product, gtin: null } as Product)).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad credentials", { status: 401 })));
    const [o] = await new EbaySource().lookup(product);
    expect(o.status).toBe("error");
    expect(o.note).toContain("HTTP 401");
  });
});

describe("helpers", () => {
  it("only treats accessory words as exclusions when they are not in the product's own name", () => {
    expect(exclusionReason("UGREEN Cat 7 Ethernet Cable 10m", "UGREEN Cat 7 Ethernet Cable 10m")).toBeNull();
    expect(exclusionReason("Cable for JBL Flip 7", "JBL Flip 7 Speaker")).toBe("accessory (cable)");
    expect(exclusionReason("JBL Flip 7 - broken, for parts", "JBL Flip 7 Speaker")).toBe("faulty/parts");
  });

  it("takes the cheapest postage option and treats free/unknown as zero", () => {
    expect(shippingCost({ shippingOptions: [{ shippingCost: { value: "4.99" } }, { shippingCost: { value: "2.50" } }] })).toBe(2.5);
    expect(shippingCost({ shippingOptions: [{ shippingCostType: "CALCULATED" }] })).toBe(0);
    expect(shippingCost({})).toBe(0);
  });
});
