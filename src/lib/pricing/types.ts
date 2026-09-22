import type { Product } from "../../db/schema";

export type ObservationStatus = "ok" | "no_price" | "blocked" | "disallowed" | "not_found" | "error";

/** One competitor price check. Failed checks are recorded too — "blocked" is a finding in itself. */
export type PriceObservation = {
  source: string;
  retailer: string;
  url?: string;
  title?: string;
  price?: number;
  currency?: string;
  condition?: string;
  availability?: string;
  status: ObservationStatus;
  note?: string;
};

/**
 * A way of finding what other retailers charge for an A1 product.
 * Add a new source by implementing this and registering it in ./index.ts.
 */
export interface PriceSource {
  readonly id: string;
  /** False when required credentials/config are absent; the runner then skips it. */
  isConfigured(): boolean;
  lookup(product: Product): Promise<PriceObservation[]>;
}
