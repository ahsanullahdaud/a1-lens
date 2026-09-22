import type { Product } from "../../db/schema";
import type { PriceObservation, PriceSource } from "./types";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

type EbayItem = {
  title?: string;
  itemWebUrl?: string;
  condition?: string;
  price?: { value?: string; currency?: string };
  seller?: { username?: string };
};

/**
 * eBay UK via the official Browse API, matched on GTIN. No scraping involved.
 * Needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (free at developer.ebay.com).
 *
 * NOTE: written against eBay's published API contract but not yet exercised
 * with real credentials — expect to debug the first run.
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
      // Compare like with like: new vs new, refurbished vs refurbished/used.
      const conditions = product.condition === "new" ? "NEW" : "CERTIFIED_REFURBISHED|EXCELLENT_REFURBISHED|VERY_GOOD_REFURBISHED|GOOD_REFURBISHED|SELLER_REFURBISHED|USED";
      const params = new URLSearchParams({
        gtin: product.gtin,
        filter: `buyingOptions:{FIXED_PRICE},conditions:{${conditions}},itemLocationCountry:GB`,
        sort: "price",
        limit: "5",
      });
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { authorization: `Bearer ${await this.getToken()}`, "x-ebay-c-marketplace-id": "EBAY_GB" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return [{ ...base, status: "error", note: `eBay API HTTP ${res.status}` }];

      const items: EbayItem[] = (await res.json()).itemSummaries ?? [];
      if (!items.length) return [{ ...base, status: "not_found", note: "no fixed-price listing for this GTIN" }];

      // Cheapest listing only; it's what a price-driven shopper would see first.
      const item = items[0];
      const price = Number(item.price?.value);
      return [
        {
          ...base,
          url: item.itemWebUrl,
          title: item.title,
          price: Number.isFinite(price) ? price : undefined,
          currency: item.price?.currency,
          condition: item.condition,
          availability: "in_stock",
          status: Number.isFinite(price) ? "ok" : "no_price",
          note: item.seller?.username ? `seller: ${item.seller.username}` : undefined,
        },
      ];
    } catch (err) {
      return [{ ...base, status: "error", note: err instanceof Error ? err.message : String(err) }];
    }
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
    if (!res.ok) throw new Error(`eBay token request failed: HTTP ${res.status}`);

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }
}
