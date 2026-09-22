import type { CheerioAPI } from "cheerio";

type Json = Record<string, unknown>;

export type Condition = "new" | "refurbished" | "used" | "unknown";
export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";

export type JsonLdOffer = {
  price?: number;
  currency?: string;
  availability: Availability;
  condition: Condition;
  priceValidUntil?: string;
  hasReturnPolicy: boolean;
  hasShippingDetails: boolean;
};

export type JsonLdProduct = {
  name?: string;
  sku?: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  description?: string;
  images: string[];
  offer?: JsonLdOffer;
};

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const hasType = (node: Json, type: string) => asArray(node["@type"] as string | string[]).includes(type);

/** Every schema.org Product node on the page, whether top-level, in an array or inside @graph. */
export function extractJsonLdProducts($: CheerioAPI): JsonLdProduct[] {
  const nodes: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collect(JSON.parse($(el).text()), nodes);
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block, keep the page.
    }
  });
  return nodes.filter((n) => hasType(n, "Product")).map(toProduct);
}

function collect(value: unknown, out: Json[]) {
  if (Array.isArray(value)) return value.forEach((v) => collect(v, out));
  if (!value || typeof value !== "object") return;
  const node = value as Json;
  out.push(node);
  if (node["@graph"]) collect(node["@graph"], out);
}

function toProduct(node: Json): JsonLdProduct {
  const brand = node.brand as Json | string | undefined;
  const images = asArray(node.image as unknown)
    .map((i) => (typeof i === "string" ? i : str((i as Json)?.url)))
    .filter((i): i is string => Boolean(i));

  return {
    name: str(node.name),
    sku: str(node.sku),
    gtin: str(node.gtin13) ?? str(node.gtin) ?? str(node.gtin14) ?? str(node.gtin12) ?? str(node.gtin8),
    mpn: str(node.mpn),
    brand: typeof brand === "string" ? str(brand) : str(brand?.name),
    description: str(node.description),
    images,
    offer: toOffer(node.offers),
  };
}

function toOffer(raw: unknown): JsonLdOffer | undefined {
  const offers = asArray(raw as Json | Json[]).filter((o) => o && typeof o === "object");
  if (!offers.length) return undefined;

  // Several offers (or an AggregateOffer) -> compare on the cheapest one.
  const priced = offers
    .map((o) => ({ o, price: Number(o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price) }))
    .sort((a, b) => (Number.isFinite(a.price) ? a.price : Infinity) - (Number.isFinite(b.price) ? b.price : Infinity));
  const { o, price } = priced[0];

  return {
    price: Number.isFinite(price) ? price : undefined,
    currency: str(o.priceCurrency) ?? str((o.priceSpecification as Json | undefined)?.priceCurrency),
    availability: toAvailability(str(o.availability)),
    condition: toCondition(str(o.itemCondition)),
    priceValidUntil: str(o.priceValidUntil),
    hasReturnPolicy: Boolean(o.hasMerchantReturnPolicy),
    hasShippingDetails: Boolean(o.shippingDetails),
  };
}

export function toCondition(value?: string): Condition {
  const v = value?.toLowerCase() ?? "";
  if (v.includes("refurbished")) return "refurbished";
  if (v.includes("used") || v.includes("damaged")) return "used";
  if (v.includes("new")) return "new";
  return "unknown";
}

export function toAvailability(value?: string): Availability {
  const v = value?.toLowerCase() ?? "";
  if (v.includes("outofstock") || v.includes("soldout") || v.includes("discontinued")) return "out_of_stock";
  if (v.includes("preorder") || v.includes("presale") || v.includes("backorder")) return "preorder";
  if (v.includes("instock") || v.includes("limitedavailability") || v.includes("onlineonly")) return "in_stock";
  return "unknown";
}
