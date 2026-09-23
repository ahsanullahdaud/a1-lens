import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ParsedProduct } from "../lib/crawler/parse-product";

/** One row per `npm run crawl` invocation. */
export const crawlRuns = pgTable("crawl_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  urlsPlanned: integer("urls_planned").notNull().default(0),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  pagesFailed: integer("pages_failed").notNull().default(0),
});

/** One row per A1 product page. `snapshot` keeps everything the parser saw. */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    slug: text("slug").notNull(),
    sku: text("sku"),
    gtin: text("gtin"),
    name: text("name"),
    brand: text("brand"),
    categoryPath: text("category_path"),
    condition: text("condition"), // new | refurbished | used | unknown
    conditionLabel: text("condition_label"),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }),
    wasPrice: numeric("was_price", { precision: 10, scale: 2, mode: "number" }),
    currency: text("currency"),
    availability: text("availability"), // in_stock | out_of_stock | preorder | unknown
    httpStatus: integer("http_status"),
    snapshot: jsonb("snapshot").$type<ParsedProduct>(),
    auditScore: integer("audit_score"),
    auditedAt: timestamp("audited_at", { withTimezone: true }),
    segment: text("segment"), // thin-feed | no-copy | standard — see lib/audit/segment.ts
    sitemapLastmod: timestamp("sitemap_lastmod", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("products_url_idx").on(t.url),
    index("products_gtin_idx").on(t.gtin),
    index("products_score_idx").on(t.auditScore),
    index("products_segment_idx").on(t.segment),
  ],
);

/** Phase 1 output: one row per (product, failed rule). Rewritten on every audit. */
export const auditFindings = pgTable(
  "audit_findings",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(), // high | medium | low
    message: text("message").notNull(),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("findings_product_idx").on(t.productId),
    index("findings_rule_idx").on(t.ruleId),
  ],
);

/** A1's own price over time, appended on each crawl when it changes. */
export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    availability: text("availability"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_history_product_idx").on(t.productId, t.capturedAt)],
);

/** Phase 2 input: competitor product pages you have matched to an A1 product by hand. */
export const competitorListings = pgTable(
  "competitor_listings",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    retailer: text("retailer").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("competitor_listings_unique_idx").on(t.productId, t.url)],
);

/** Phase 2 output: every price check we ever made, including the failed ones. */
export const competitorPrices = pgTable(
  "competitor_prices",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // url | ebay
    retailer: text("retailer").notNull(),
    url: text("url"),
    title: text("title"),
    /** Landed price: item + postage to the UK — what a shopper actually compares. */
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }),
    itemPrice: numeric("item_price", { precision: 10, scale: 2, mode: "number" }),
    shippingCost: numeric("shipping_cost", { precision: 10, scale: 2, mode: "number" }),
    currency: text("currency"),
    condition: text("condition"),
    availability: text("availability"),
    seller: text("seller"),
    sellerType: text("seller_type"), // business | individual | retailer
    status: text("status").notNull(), // ok | no_price | blocked | disallowed | not_found | error
    note: text("note"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("competitor_prices_product_idx").on(t.productId, t.capturedAt)],
);

export type Product = typeof products.$inferSelect;
export type AuditFinding = typeof auditFindings.$inferSelect;
export type CompetitorPrice = typeof competitorPrices.$inferSelect;
