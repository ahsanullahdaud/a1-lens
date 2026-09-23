import type { Product } from "../../db/schema";
import type { PriceObservation, PriceSource } from "./types";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const MARKETPLACE = "EBAY_GB";
/** Postage is quoted to this delivery point: A1's Manchester head office. */
const DELIVERY_CONTEXT = "contextualLocation=country=GB,zip=M15AN";
const PAGE_SIZE = 50;

/** eBay conditions comparable with each A1 condition. "For parts or not working" is never requested. */
const CONDITIONS: Record<string, string[]> = {
  new: ["NEW"],
  refurbished: ["CERTIFIED_REFURBISHED", "EXCELLENT_REFURBISHED", "VERY_GOOD_REFURBISHED", "GOOD_REFURBISHED", "SELLER_REFURBISHED"],
  used: ["USED"],
};

/** A listing whose title says this is not selling a working product. */
const FAULTY = /\b(faulty|spares?|parts only|for parts|not working|broken|cracked|damaged|defective|untested|read description|no power)\b/i;
/** …or is selling something that goes *with* the product rather than the product. */
const ACCESSORY =
  /\b(case|cover|cable|charger|adapter|adaptor|protector|skin|strap|stand|mount|dock|box only|empty box|manual only|remote only|controller only|replacement|compatible with|for use with)\b/i;
/** Below this share of A1's price a "match" is almost certainly an accessory, a part or a scam. */
const MIN_PRICE_RATIO = 0.3;

export type EbayItem = {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  condition?: string;
  conditionId?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: { shippingCostType?: string; shippingCost?: { value?: string; currency?: string } }[];
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number; sellerAccountType?: string };
  itemLocation?: { country?: string };
};

type Candidate = { item: EbayItem; itemPrice: number; shipping: number; landed: number; business: boolean };

/**
 * Why a listing is not a fair comparison, or null if it is.
 * Accessory words that appear in A1's own product name don't count — a listing
 * for an ethernet cable is allowed to say "cable".
 */
export function exclusionReason(title: string, productName: string): string | null {
  if (FAULTY.test(title)) return "faulty/parts";
  const own = productName.toLowerCase();
  const hit = (title.match(new RegExp(ACCESSORY.source, "gi")) ?? []).find((w) => !own.includes(w.toLowerCase()));
  return hit ? `accessory (${hit.toLowerCase()})` : null;
}

const money = (v?: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Cheapest postage option to GB; free / calculated-later options count as 0. */
export function shippingCost(item: EbayItem): number {
  const costs = (item.shippingOptions ?? []).map((o) => money(o.shippingCost?.value) ?? 0);
  return costs.length ? Math.min(...costs) : 0;
}

/**
 * eBay UK via the official Browse API, matched on GTIN. No scraping involved.
 * Needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (free at developer.ebay.com).
 *
 * Fair-comparison rules: buy-it-now only, item located in the UK, postage to the
 * UK included in the price, same condition class as A1's listing, no faulty /
 * parts / accessory listings, and business sellers preferred over individuals.
 */
export class EbaySource implements PriceSource {
  readonly id = "ebay";
  private token?: { value: string; expiresAt: number };

  isConfigured() {
    return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
  }

  async lookup(product: Product): Promise<PriceObservation[]> {
    if (!product.gtin) return [];
    const base = { source: this.id, retailer: "eBay UK" };

    try {
      const items = await this.search(product.gtin, CONDITIONS[product.condition ?? "new"] ?? CONDITIONS.new);
      if (!items.length) return [{ ...base, status: "not_found", note: "no buy-it-now listing in the UK for this GTIN" }];

      const skipped: string[] = [];
      const candidates: Candidate[] = [];
      for (const item of items) {
        const itemPrice = money(item.price?.value);
        if (itemPrice == null) continue;
        const reason = exclusionReason(item.title ?? "", product.name ?? "");
        if (reason) {
          skipped.push(reason);
          continue;
        }
        if (item.itemLocation?.country && item.itemLocation.country !== "GB") {
          skipped.push("not UK");
          continue;
        }
        const shipping = shippingCost(item);
        const landed = itemPrice + shipping;
        if (product.price != null && landed < product.price * MIN_PRICE_RATIO) {
          skipped.push("too cheap to be the product");
          continue;
        }
        candidates.push({ item, itemPrice, shipping, landed, business: item.seller?.sellerAccountType === "BUSINESS" });
      }

      if (!candidates.length) {
        return [{ ...base, status: "not_found", note: `${items.length} listing(s) found, none comparable: ${summarise(skipped)}` }];
      }

      // Business sellers first, then cheapest landed price.
      candidates.sort((a, b) => Number(b.business) - Number(a.business) || a.landed - b.landed);
      const best = candidates[0];
      const cheaperIndividual = best.business ? candidates.find((c) => !c.business && c.landed < best.landed) : undefined;

      const notes = [
        `${candidates.length} comparable of ${items.length}`,
        skipped.length ? `skipped ${summarise(skipped)}` : "",
        best.item.seller?.feedbackPercentage ? `feedback ${best.item.seller.feedbackPercentage}% (${best.item.seller.feedbackScore ?? "?"})` : "",
        cheaperIndividual ? `individual seller cheaper at £${cheaperIndividual.landed.toFixed(2)}` : "",
      ].filter(Boolean);

      return [
        {
          ...base,
          url: best.item.itemWebUrl,
          title: best.item.title,
          price: best.landed,
          itemPrice: best.itemPrice,
          shippingCost: best.shipping,
          currency: best.item.price?.currency,
          condition: best.item.condition,
          availability: "in_stock",
          seller: best.item.seller?.username,
          sellerType: best.item.seller?.sellerAccountType?.toLowerCase() ?? "unknown",
          status: "ok",
          note: notes.join("; "),
        },
      ];
    } catch (err) {
      return [{ ...base, status: "error", note: err instanceof Error ? err.message : String(err) }];
    }
  }

  private async search(gtin: string, conditions: string[]): Promise<EbayItem[]> {
    const params = new URLSearchParams({
      gtin,
      filter: `buyingOptions:{FIXED_PRICE},itemLocationCountry:GB,deliveryCountry:GB,conditions:{${conditions.join("|")}}`,
      sort: "price",
      limit: String(PAGE_SIZE),
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: {
        authorization: `Bearer ${await this.getToken()}`,
        "x-ebay-c-marketplace-id": MARKETPLACE,
        "x-ebay-c-enduserctx": DELIVERY_CONTEXT,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`eBay search HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { itemSummaries?: EbayItem[] }).itemSummaries ?? [];
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const credentials = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { authorization: `Basic ${credentials}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`eBay token request failed: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }
}

/** "accessory (case) ×3, faulty/parts ×1" */
function summarise(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([r, n]) => (n > 1 ? `${r} ×${n}` : r)).join(", ");
}
