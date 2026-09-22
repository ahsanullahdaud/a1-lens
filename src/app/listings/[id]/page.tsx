import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, gbp, ScoreMeter, SeverityBadge } from "@/components/ui";
import { RULES_BY_ID, type Severity } from "@/lib/audit/rules";
import { SEGMENT_BY_ID, type Segment } from "@/lib/audit/segment";
import { getListing } from "@/lib/queries";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = Number.isInteger(Number(id)) ? await getListing(Number(id)) : null;
  if (!data) notFound();

  const { product, findings, history, competitors } = data;
  const snapshot = product.snapshot;
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const facts: [string, string][] = [
    ["Price", `${gbp(product.price)}${product.wasPrice ? ` (was ${gbp(product.wasPrice)})` : ""}`],
    ["Condition", product.conditionLabel ?? product.condition ?? "—"],
    ["Availability", product.availability?.replace(/_/g, " ") ?? "—"],
    ["Brand", product.brand ?? "—"],
    ["SKU", product.sku ?? "—"],
    ["GTIN", product.gtin ?? "—"],
    ["Category", product.categoryPath ?? "—"],
    ["Segment", (product.segment && SEGMENT_BY_ID.get(product.segment as Segment)?.label) ?? "—"],
    ["Images", String(snapshot?.galleryImageCount ?? "—")],
    ["Spec rows", String(snapshot?.specs?.length ?? "—")],
    ["Description", snapshot?.description ? `${snapshot.description.length} characters` : "—"],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/listings" className="text-sm text-ink-2 hover:text-ink">← Listings</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <h1 className="max-w-3xl text-2xl font-semibold text-ink">{product.name ?? product.slug}</h1>
          <ScoreMeter score={product.auditScore} />
        </div>
        <a href={product.url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-sm text-accent hover:underline">
          {product.url} ↗
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Findings (${findings.length})`} className="lg:col-span-2">
          {sorted.length === 0 ? (
            <p className="text-sm text-ink-2">No findings. This listing passes every rule.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {sorted.map((f) => {
                const rule = RULES_BY_ID.get(f.ruleId);
                return (
                  <li key={f.id} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <SeverityBadge severity={f.severity as Severity} />
                      <Link href={`/listings?rule=${f.ruleId}`} className="font-medium text-ink hover:text-accent hover:underline">
                        {rule?.title ?? f.ruleId}
                      </Link>
                    </div>
                    <p className="text-ink">{f.message}</p>
                    {f.evidence && <p className="break-all font-mono text-xs text-muted">{f.evidence}</p>}
                    {rule && <p className="text-ink-2"><span className="font-medium">Fix: </span>{rule.fix}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Listing facts">
          <dl className="space-y-2 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-ink-2">{label}</dt>
                <dd className="text-right text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {(snapshot?.conditionVariants?.length ?? 0) > 0 && (
        <Card title="Condition variants" subtitle="Each grade is priced by whichever supplier offer is currently winning.">
          <table className="w-full text-sm">
            <tbody>
              {snapshot!.conditionVariants.map((v) => (
                <tr key={v.id} className="border-b border-hairline last:border-0">
                  <td className="py-2 text-ink">{v.label}{v.selected && <span className="ml-2 text-xs text-muted">default</span>}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{v.outOfStock ? <span className="text-muted">Out of stock</span> : gbp(v.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Competitor prices" subtitle="Latest checks from the price lens.">
          {competitors.length === 0 ? (
            <p className="text-sm text-ink-2">No competitor checks yet. Map a competitor URL in data/competitor-urls.csv, then run npm run prices.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {competitors.map((c) => (
                  <tr key={c.id} className="border-b border-hairline last:border-0">
                    <td className="py-2 text-ink">{c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">{c.retailer} ↗</a> : c.retailer}</td>
                    <td className="py-2 text-ink-2">{c.status === "ok" ? c.condition ?? "" : c.status.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right tabular-nums text-ink">{gbp(c.price)}</td>
                    <td className="py-2 text-right text-xs text-muted">{c.capturedAt.toLocaleDateString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="A1 price history" subtitle="Appended whenever a crawl sees the price or stock status change.">
          <table className="w-full text-sm">
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-hairline last:border-0">
                  <td className="py-2 text-ink-2">{h.capturedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="py-2 text-ink-2">{h.availability?.replace(/_/g, " ")}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{gbp(h.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
