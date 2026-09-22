import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { auditProduct } from "./audit";
import { classifySegment } from "./audit/segment";
import type { ParsedProduct } from "./crawler/parse-product";
import { conditionFromLabel } from "./audit/rules";

const { products, auditFindings, priceHistory } = schema;

/** Insert or refresh a product row from a freshly parsed page. Returns its id. */
export async function saveCrawledProduct(parsed: ParsedProduct, httpStatus: number, sitemapLastmod?: Date): Promise<number> {
  const ld = parsed.jsonLd;
  const labelCondition = conditionFromLabel(parsed.conditionLabel);
  const values = {
    url: parsed.url,
    slug: parsed.slug,
    sku: ld?.sku ?? null,
    gtin: ld?.gtin ?? null,
    name: ld?.name ?? parsed.h1 ?? null,
    brand: ld?.brand ?? null,
    categoryPath: parsed.breadcrumbs.join(" > ") || null,
    // The label is what the page opens on; JSON-LD may describe another condition tab.
    condition: labelCondition !== "unknown" ? labelCondition : (ld?.offer?.condition ?? "unknown"),
    conditionLabel: parsed.conditionLabel ?? null,
    // The buy-box price belongs to `conditionLabel`; JSON-LD may describe another variant.
    price: parsed.visiblePrice ?? ld?.offer?.price ?? null,
    wasPrice: parsed.visibleWasPrice ?? null,
    currency: ld?.offer?.currency ?? null,
    availability: ld?.offer?.availability ?? (parsed.outOfStockNotice ? "out_of_stock" : "unknown"),
    httpStatus,
    snapshot: parsed,
    sitemapLastmod: sitemapLastmod ?? null,
    lastCrawledAt: new Date(),
  };

  const [row] = await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({ target: products.url, set: values })
    .returning({ id: products.id });

  // Append to price history only when the price or stock status actually moved.
  if (values.price != null) {
    const [last] = await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.productId, row.id))
      .orderBy(desc(priceHistory.capturedAt))
      .limit(1);
    if (!last || last.price !== values.price || last.availability !== values.availability) {
      await db.insert(priceHistory).values({ productId: row.id, price: values.price, availability: values.availability });
    }
  }
  return row.id;
}

/** Re-run the rules for one product and replace its stored findings. */
export async function saveAudit(productId: number, parsed: ParsedProduct) {
  const { score, findings } = auditProduct(parsed);
  const segment = classifySegment(parsed);
  await db.transaction(async (tx) => {
    await tx.delete(auditFindings).where(eq(auditFindings.productId, productId));
    if (findings.length) {
      await tx.insert(auditFindings).values(findings.map((f) => ({ productId, ...f, evidence: f.evidence ?? null })));
    }
    await tx.update(products).set({ auditScore: score, auditedAt: new Date(), segment }).where(eq(products.id, productId));
  });
  return { score, findings, segment };
}
