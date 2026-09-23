import { and, asc, count, desc, eq, ilike, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "../db";
import { RULES_BY_ID, type Severity } from "./audit/rules";
import { SEGMENTS, type Segment } from "./audit/segment";

const { products, auditFindings, crawlRuns, competitorPrices, priceHistory } = schema;

export const PAGE_SIZE = 25;

/** A rule that hits this share of the whole catalogue is a template problem, not a per-category one. */
const TEMPLATE_WIDE_SHARE = 0.9;

export const isSegment = (value: string | undefined): value is Segment => SEGMENTS.some((s) => s.id === value);

/** Matches a category and everything nested under it ("Computing" -> "Computing > Laptops > …"). */
const categoryFilter = (category: string) => or(eq(products.categoryPath, category), like(products.categoryPath, `${category} > %`))!;

const avgScore = sql<number | null>`round(avg(${products.auditScore}))::int`;

// Every query awaits connection() so Next renders these pages per request
// instead of baking today's numbers into a static build.

export async function getOverview(segment?: Segment) {
  await connection();
  const productWhere = and(isNotNull(products.auditScore), segment ? eq(products.segment, segment) : undefined);
  const findingWhere = segment
    ? inArray(auditFindings.productId, db.select({ id: products.id }).from(products).where(eq(products.segment, segment)))
    : undefined;

  const [[totals], [findingTotals], perRule, scoreRows, worst, [lastRun], segmentRows] = await Promise.all([
    db.select({ listings: count(), avgScore }).from(products).where(productWhere),
    db
      .select({
        findings: count(),
        high: sql<number>`count(*) filter (where ${auditFindings.severity} = 'high')::int`,
        listingsWithHigh: sql<number>`count(distinct ${auditFindings.productId}) filter (where ${auditFindings.severity} = 'high')::int`,
      })
      .from(auditFindings)
      .where(findingWhere),
    db
      .select({ ruleId: auditFindings.ruleId, affected: sql<number>`count(distinct ${auditFindings.productId})::int` })
      .from(auditFindings)
      .where(findingWhere)
      .groupBy(auditFindings.ruleId),
    db
      .select({ bucket: sql<number>`least(floor(${products.auditScore} / 10.0), 9)::int`, n: count() })
      .from(products)
      .where(productWhere)
      .groupBy(sql`1`),
    db
      .select({ id: products.id, name: products.name, slug: products.slug, score: products.auditScore, brand: products.brand })
      .from(products)
      .where(productWhere)
      .orderBy(asc(products.auditScore), asc(products.id))
      .limit(8),
    db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(1),
    db
      .select({ segment: products.segment, n: count(), avgScore })
      .from(products)
      .where(isNotNull(products.auditScore))
      .groupBy(products.segment),
  ]);

  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const rules = perRule
    .flatMap((row) => {
      const rule = RULES_BY_ID.get(row.ruleId);
      return rule ? [{ rule, affected: row.affected, share: totals.listings ? row.affected / totals.listings : 0 }] : [];
    })
    .sort((a, b) => severityOrder[a.rule.severity] - severityOrder[b.rule.severity] || b.affected - a.affected);

  const histogram = Array.from({ length: 10 }, (_, bucket) => ({
    bucket,
    label: bucket === 9 ? "90–100" : `${bucket * 10}–${bucket * 10 + 9}`,
    n: scoreRows.find((r) => r.bucket === bucket)?.n ?? 0,
  }));

  const allAudited = segmentRows.reduce((sum, r) => sum + r.n, 0);
  const segments = SEGMENTS.map((s) => {
    const row = segmentRows.find((r) => r.segment === s.id);
    return { ...s, n: row?.n ?? 0, share: allAudited ? (row?.n ?? 0) / allAudited : 0, avgScore: row?.avgScore ?? null };
  });

  return { ...totals, ...findingTotals, rules, histogram, worst, lastRun, segments, allAudited, segment };
}

export type ListingFilters = { rule?: string; severity?: string; q?: string; segment?: string; category?: string; page?: number };

export async function getListings({ rule, severity, q, segment, category, page = 1 }: ListingFilters) {
  await connection();
  const filters = [isNotNull(products.auditScore)];
  if (q) filters.push(or(ilike(products.name, `%${q}%`), ilike(products.brand, `%${q}%`), ilike(products.sku, `%${q}%`))!);
  if (isSegment(segment)) filters.push(eq(products.segment, segment));
  if (category) filters.push(categoryFilter(category));
  if (rule || severity) {
    const matching = db
      .select({ id: auditFindings.productId })
      .from(auditFindings)
      .where(and(rule ? eq(auditFindings.ruleId, rule) : undefined, severity ? eq(auditFindings.severity, severity) : undefined));
    filters.push(inArray(products.id, matching));
  }
  const where = and(...filters);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        brand: products.brand,
        price: products.price,
        conditionLabel: products.conditionLabel,
        availability: products.availability,
        segment: products.segment,
        score: products.auditScore,
        // "products"."id" is spelled out: Drizzle renders ${products.id} as a bare "id" in a
        // single-table select, which inside the subquery would bind to audit_findings.id.
        high: sql<number>`(select count(*) from audit_findings f where f.product_id = "products"."id" and f.severity = 'high')::int`,
        medium: sql<number>`(select count(*) from audit_findings f where f.product_id = "products"."id" and f.severity = 'medium')::int`,
        low: sql<number>`(select count(*) from audit_findings f where f.product_id = "products"."id" and f.severity = 'low')::int`,
      })
      .from(products)
      .where(where)
      .orderBy(asc(products.auditScore), asc(products.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(products).where(where),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Top-level category names, most populated first — for filter dropdowns. */
export async function getCategoryNames() {
  await connection();
  const rows = await db
    .select({ name: sql<string>`split_part(${products.categoryPath}, ' > ', 1)`, n: count() })
    .from(products)
    .where(isNotNull(products.categoryPath))
    .groupBy(sql`1`)
    .orderBy(desc(count()));
  return rows.map((r) => r.name).filter(Boolean);
}

export async function getListing(id: number) {
  await connection();
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) return null;
  const [findings, history, competitors] = await Promise.all([
    db.select().from(auditFindings).where(eq(auditFindings.productId, id)),
    db.select().from(priceHistory).where(eq(priceHistory.productId, id)).orderBy(desc(priceHistory.capturedAt)).limit(20),
    db.select().from(competitorPrices).where(eq(competitorPrices.productId, id)).orderBy(desc(competitorPrices.capturedAt)).limit(30),
  ]);
  return { product, findings, history, competitors };
}

/**
 * One row per category at the requested depth: top level by default, or the
 * children of `parent`. Each row carries its top three issues, ignoring rules
 * that hit almost the whole catalogue (those are template fixes, listed once
 * on the overview).
 */
export async function getCategoryScorecard(parent?: string) {
  await connection();
  const level = parent ? 2 : 1;
  const scope = parent ? categoryFilter(parent) : undefined;
  const name = sql<string>`coalesce(nullif(split_part(${products.categoryPath}, ' > ', ${level}), ''), 'Uncategorised')`;

  const [rows, ruleRows, overallRules, [{ catalogue }]] = await Promise.all([
    db
      .select({
        name,
        n: count(),
        avgScore,
        thinFeed: sql<number>`count(*) filter (where ${products.segment} = 'thin-feed')::int`,
        noCopy: sql<number>`count(*) filter (where ${products.segment} = 'no-copy')::int`,
        withHigh: sql<number>`count(*) filter (where exists (select 1 from audit_findings f where f.product_id = "products"."id" and f.severity = 'high'))::int`,
      })
      .from(products)
      .where(and(isNotNull(products.auditScore), scope))
      .groupBy(sql`1`)
      .orderBy(desc(count())),
    db
      .select({ name, ruleId: auditFindings.ruleId, affected: sql<number>`count(distinct ${products.id})::int` })
      .from(auditFindings)
      .innerJoin(products, eq(products.id, auditFindings.productId))
      .where(scope)
      .groupBy(sql`1`, auditFindings.ruleId),
    db
      .select({ ruleId: auditFindings.ruleId, affected: sql<number>`count(distinct ${auditFindings.productId})::int` })
      .from(auditFindings)
      .groupBy(auditFindings.ruleId),
    db.select({ catalogue: count() }).from(products).where(isNotNull(products.auditScore)),
  ]);

  const templateWide = overallRules.filter((r) => catalogue && r.affected / catalogue >= TEMPLATE_WIDE_SHARE).map((r) => r.ruleId);

  return {
    parent,
    templateWide: templateWide.flatMap((id) => RULES_BY_ID.get(id) ?? []),
    rows: rows.map((row) => ({
      ...row,
      thinShare: row.n ? (row.thinFeed + row.noCopy) / row.n : 0,
      topIssues: ruleRows
        .filter((r) => r.name === row.name && !templateWide.includes(r.ruleId) && RULES_BY_ID.has(r.ruleId))
        .sort((a, b) => b.affected - a.affected)
        .slice(0, 3)
        .map((r) => ({ rule: RULES_BY_ID.get(r.ruleId)!, affected: r.affected, share: row.n ? r.affected / row.n : 0 })),
    })),
  };
}

/** Everything the feed-quality page needs to present the thin import as one problem. */
export async function getFeedQuality() {
  await connection();
  const thin = eq(products.segment, "thin-feed");
  const topCategory = sql<string>`coalesce(nullif(split_part(${products.categoryPath}, ' > ', 1), ''), 'Uncategorised')`;

  const [segmentRows, [signals], byCategory, byBrand, sample] = await Promise.all([
    db
      .select({ segment: products.segment, n: count(), avgScore, withGtin: sql<number>`count(${products.gtin})::int` })
      .from(products)
      .where(isNotNull(products.auditScore))
      .groupBy(products.segment),
    db
      .select({
        oneImage: sql<number>`count(*) filter (where greatest(coalesce((${products.snapshot}->>'galleryImageCount')::int, 0), jsonb_array_length(coalesce(${products.snapshot}->'jsonLd'->'images', '[]'))) <= 1)::int`,
        placeholderSpecs: sql<number>`count(*) filter (where jsonb_array_length(${products.snapshot}->'specs') <= 2)::int`,
        shortDescription: sql<number>`count(*) filter (where length(coalesce(${products.snapshot}->>'description', '')) < 100)::int`,
        truncatedName: sql<number>`count(*) filter (where ${products.name} ~* '([,&–-]|[[:<:]](that|with|and|for|of|the|to|in|x|from|or|by))[[:space:]]*$')::int`,
        brandNotInName: sql<number>`count(*) filter (where ${products.brand} is not null and position(lower(split_part(${products.brand}, ' ', 1)) in lower(${products.name})) = 0)::int`,
        dedupeSlug: sql<number>`count(*) filter (where ${products.slug} ~ '-[0-9]+$')::int`,
        noGtin: sql<number>`count(*) filter (where ${products.gtin} is null)::int`,
      })
      .from(products)
      .where(thin),
    db
      .select({ name: topCategory, thinFeed: sql<number>`count(*) filter (where ${products.segment} = 'thin-feed')::int`, n: count() })
      .from(products)
      .where(isNotNull(products.auditScore))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`)),
    db
      .select({ brand: sql<string>`coalesce(${products.brand}, 'Unknown')`, thinFeed: sql<number>`count(*) filter (where ${products.segment} = 'thin-feed')::int`, n: count() })
      .from(products)
      .where(isNotNull(products.auditScore))
      .groupBy(sql`1`)
      .having(sql`count(*) filter (where ${products.segment} = 'thin-feed') > 0`)
      .orderBy(desc(sql`2`))
      .limit(12),
    db
      .select({ id: products.id, name: products.name, slug: products.slug, brand: products.brand, score: products.auditScore })
      .from(products)
      .where(thin)
      .orderBy(asc(products.auditScore), asc(products.id))
      .limit(8),
  ]);

  const total = segmentRows.reduce((sum, r) => sum + r.n, 0);
  const bySegment = Object.fromEntries(segmentRows.map((r) => [r.segment ?? "standard", r])) as Record<string, (typeof segmentRows)[number] | undefined>;
  const thinRow = bySegment["thin-feed"];
  const thinN = thinRow?.n ?? 0;

  return {
    total,
    thinN,
    thinShare: total ? thinN / total : 0,
    thinAvgScore: thinRow?.avgScore ?? null,
    thinWithGtin: thinRow?.withGtin ?? 0,
    noCopyN: bySegment["no-copy"]?.n ?? 0,
    noCopyAvgScore: bySegment["no-copy"]?.avgScore ?? null,
    standardAvgScore: bySegment["standard"]?.avgScore ?? null,
    // The signature is what classifySegment tests for, so these are 100% by construction.
    signature: [
      { label: "Single product image", n: signals.oneImage },
      { label: "Spec table is only brand + EAN", n: signals.placeholderSpecs },
      { label: "Description under 100 characters", n: signals.shortDescription },
    ],
    signals: [
      { label: "Brand missing from the product name", n: signals.brandNotInName },
      { label: "URL ends in a dedupe number (…-2, …-10)", n: signals.dedupeSlug },
      { label: "Name looks cut off mid-sentence", n: signals.truncatedName },
      { label: "No GTIN / EAN", n: signals.noGtin },
    ].map((s) => ({ ...s, share: thinN ? s.n / thinN : 0 })),
    byCategory: byCategory.filter((c) => c.thinFeed > 0).map((c) => ({ ...c, share: c.n ? c.thinFeed / c.n : 0 })),
    byBrand: byBrand.map((b) => ({ ...b, share: b.n ? b.thinFeed / b.n : 0 })),
    sample,
  };
}

export type PriceObservationRow = {
  id: number;
  retailer: string;
  url: string | null;
  title: string | null;
  price: number | null;
  itemPrice: number | null;
  shippingCost: number | null;
  wasPrice: number | null;
  availability: string | null;
  match: string | null;
  matchNote: string | null;
  source: string;
  status: string;
  note: string | null;
  capturedAt: Date;
};

export type PriceLensProduct = {
  productId: number;
  name: string | null;
  slug: string;
  a1Price: number | null;
  a1WasPrice: number | null;
  conditionLabel: string | null;
  observations: PriceObservationRow[];
  /** Distinct retailers we looked at, including ones that returned no price. */
  retailersChecked: string[];
  /** Cheapest exact/uncertain match with a price. Near-matches never set the headline. */
  cheapest?: PriceObservationRow;
  /** A1 minus the cheapest comparable: positive = A1 is dearer. */
  gap?: number;
  gapPct?: number;
};

/**
 * Every product with at least one competitor check: the latest observation per
 * URL, the cheapest comparable one, and A1's gap to it. Products where A1 is
 * dearer come first.
 */
export async function getPriceLens() {
  await connection();
  const latest = await db
    .selectDistinctOn([competitorPrices.productId, competitorPrices.url], {
      id: competitorPrices.id,
      productId: competitorPrices.productId,
      retailer: competitorPrices.retailer,
      url: competitorPrices.url,
      title: competitorPrices.title,
      price: competitorPrices.price,
      itemPrice: competitorPrices.itemPrice,
      shippingCost: competitorPrices.shippingCost,
      wasPrice: competitorPrices.wasPrice,
      availability: competitorPrices.availability,
      match: competitorPrices.match,
      matchNote: competitorPrices.matchNote,
      source: competitorPrices.source,
      status: competitorPrices.status,
      note: competitorPrices.note,
      capturedAt: competitorPrices.capturedAt,
      name: products.name,
      slug: products.slug,
      a1Price: products.price,
      a1WasPrice: products.wasPrice,
      conditionLabel: products.conditionLabel,
    })
    .from(competitorPrices)
    .innerJoin(products, eq(products.id, competitorPrices.productId))
    .orderBy(competitorPrices.productId, competitorPrices.url, desc(competitorPrices.capturedAt));

  const byProduct = new Map<number, PriceLensProduct>();
  for (const o of latest) {
    const entry =
      byProduct.get(o.productId) ??
      byProduct.set(o.productId, {
        productId: o.productId,
        name: o.name,
        slug: o.slug,
        a1Price: o.a1Price,
        a1WasPrice: o.a1WasPrice,
        conditionLabel: o.conditionLabel,
        observations: [],
        retailersChecked: [],
      }).get(o.productId)!;
    entry.observations.push(o);
  }

  const rows = [...byProduct.values()].map((p) => {
    p.observations.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.retailer.localeCompare(b.retailer));
    p.retailersChecked = [...new Set(p.observations.map((o) => o.retailer))];
    p.cheapest = p.observations.find((o) => o.status === "ok" && o.price != null && o.match !== "near");
    if (p.cheapest && p.a1Price != null) {
      p.gap = p.a1Price - p.cheapest.price!;
      p.gapPct = (p.gap / p.cheapest.price!) * 100;
    }
    return p;
  });

  // Dearer first (largest overrun at the top), then the rest by how far ahead A1 is.
  rows.sort((a, b) => (b.gapPct ?? -Infinity) - (a.gapPct ?? -Infinity));

  const compared = rows.filter((r) => r.gapPct != null);
  const gaps = compared.map((r) => r.gapPct!).sort((a, b) => a - b);
  const failed = latest.filter((o) => o.status !== "ok");
  return {
    rows,
    compared: compared.length,
    a1Cheapest: compared.filter((r) => r.gapPct! <= 0).length,
    a1Dearer: compared.filter((r) => r.gapPct! > 0).length,
    medianGapPct: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    failedChecks: failed.length,
    blockedRetailers: [...new Set(failed.filter((o) => o.status === "blocked" || o.status === "disallowed").map((o) => o.retailer))],
    lastFetched: latest.reduce<Date | null>((max, o) => (!max || o.capturedAt > max ? o.capturedAt : max), null),
  };
}
