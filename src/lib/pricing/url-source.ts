import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import type { Product } from "../../db/schema";
import type { PoliteFetcher } from "../crawler/http";
import { extractJsonLdProducts } from "../jsonld";
import type { PriceObservation, PriceSource } from "./types";

/** Pull the cheapest schema.org Offer out of any retailer's product page. */
export function readOfferFromHtml(html: string): Pick<PriceObservation, "title" | "price" | "currency" | "condition" | "availability"> | null {
  const products = extractJsonLdProducts(cheerio.load(html)).filter((p) => p.offer?.price != null);
  if (!products.length) return null;
  const best = products.sort((a, b) => a.offer!.price! - b.offer!.price!)[0];
  return {
    title: best.name,
    price: best.offer!.price,
    currency: best.offer!.currency,
    condition: best.offer!.condition,
    availability: best.offer!.availability,
  };
}

/**
 * Checks competitor pages that *you* matched by hand (data/competitor-urls.csv).
 * Works on any retailer that publishes schema.org Product markup and permits
 * crawling in robots.txt. Retailers that block bots are recorded as `blocked`
 * and left alone.
 */
export class MappedUrlSource implements PriceSource {
  readonly id = "url";
  constructor(private readonly fetcher: PoliteFetcher) {}

  isConfigured() {
    return true;
  }

  async lookup(product: Product): Promise<PriceObservation[]> {
    const listings = await db
      .select()
      .from(schema.competitorListings)
      .where(eq(schema.competitorListings.productId, product.id));

    const observations: PriceObservation[] = [];
    for (const listing of listings) {
      const base = { source: this.id, retailer: listing.retailer, url: listing.url };
      const res = await this.fetcher.get(listing.url);
      if (res.status !== "ok" || !res.html) {
        observations.push({ ...base, status: res.status === "ok" ? "error" : res.status, note: res.note });
        continue;
      }
      const offer = readOfferFromHtml(res.html);
      observations.push(
        offer
          ? { ...base, ...offer, itemPrice: offer.price, sellerType: "retailer", status: "ok" }
          : { ...base, status: "no_price", note: "no schema.org Offer on the page" },
      );
    }
    return observations;
  }
}
