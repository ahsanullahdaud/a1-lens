import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "../db";
import { RULES_BY_ID, type Severity } from "./audit/rules";

const { products, auditFindings, crawlRuns, competitorPrices, priceHistory } = schema;

export const PAGE_SIZE = 25;

// Every query awaits connection() so Next renders these pages per request
// instead of baking today's numbers into a static build.

export async function getOverview() {
  await connection();
  const [[totals], [findingTotals], perRule, scoreRows, worst, [lastRun]] = await Promise.all([
    db
      .select({ listings: count(), avgScore: sql<number | null>`round(avg(${products.auditScore}))::int` })
      .from(products)
      .where(isNotNull(products.auditScore)),
    db
      .select({
        findings: count(),
        high: sql<number>`count(*) filter (where ${auditFindings.severity} = 'high')::int`,
        listingsWithHigh: sql<number>`count(distinct ${auditFindings.productId}) filter (where ${auditFindings.severity} = 'high')::int`,
      })
      .from(auditFindings),
    db
      .select({ ruleId: auditFindings.ruleId, affected: sql<number>`count(distinct ${auditFindings.productId})::int` })
      .from(auditFindings)
      .groupBy(auditFindings.ruleId),
    db
      .select({ bucket: sql<number>`least(floor(${products.auditScore} / 10.0), 9)::int`, n: count() })
      .from(products)
      .where(isNotNull(products.auditScore))
      .groupBy(sql`1`),
    db
      .select({ id: products.id, name: products.name, slug: products.slug, score: products.auditScore, brand: products.brand })
      .from(products)
      .where(isNotNull(products.auditScore))
      .orderBy(asc(products.auditScore), asc(products.id))
      .limit(8),
    db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(1),
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

  return { ...totals, ...findingTotals, rules, histogram, worst, lastRun };
}

export type ListingFilters = { rule?: string; severity?: string; q?: string; page?: number };

export async function getListings({ rule, severity, q, page = 1 }: ListingFilters) {
  await connection();
  const filters = [isNotNull(products.auditScore)];
  if (q) filters.push(or(ilike(products.name, `%${q}%`), ilike(products.brand, `%${q}%`), ilike(products.sku, `%${q}%`))!);
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

/** Latest successful observation per (product, retailer), compared against A1's current price. */
export async function getPriceLens() {
  await connection();
  const latest = await db
    .selectDistinctOn([competitorPrices.productId, competitorPrices.retailer], {
      productId: competitorPrices.productId,
      retailer: competitorPrices.retailer,
      url: competitorPrices.url,
      price: competitorPrices.price,
      status: competitorPrices.status,
      capturedAt: competitorPrices.capturedAt,
      name: products.name,
      slug: products.slug,
      a1Price: products.price,
    })
    .from(competitorPrices)
    .innerJoin(products, eq(products.id, competitorPrices.productId))
    .orderBy(competitorPrices.productId, competitorPrices.retailer, desc(competitorPrices.capturedAt));

  type Row = { productId: number; name: string | null; slug: string; a1Price: number; cheapest: { retailer: string; price: number; url: string | null }; gapPct: number };
  const byProduct = new Map<number, Row>();
  for (const o of latest) {
    if (o.status !== "ok" || o.price == null || o.a1Price == null) continue;
    const current = byProduct.get(o.productId);
    if (current && current.cheapest.price <= o.price) continue;
    byProduct.set(o.productId, {
      productId: o.productId,
      name: o.name,
      slug: o.slug,
      a1Price: o.a1Price,
      cheapest: { retailer: o.retailer, price: o.price, url: o.url },
      // Negative = A1 is cheaper than the best competitor. Positive = A1 is being undercut.
      gapPct: ((o.a1Price - o.price) / o.price) * 100,
    });
  }

  const rows = [...byProduct.values()].sort((a, b) => b.gapPct - a.gapPct);
  const gaps = rows.map((r) => r.gapPct).sort((a, b) => a - b);
  const failed = latest.filter((o) => o.status !== "ok");
  return {
    rows,
    compared: rows.length,
    a1Cheapest: rows.filter((r) => r.gapPct <= 0).length,
    medianGapPct: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    failedChecks: failed.length,
    blockedRetailers: [...new Set(failed.filter((o) => o.status === "blocked" || o.status === "disallowed").map((o) => o.retailer))],
  };
}
