import Link from "next/link";
import { Card, Code, EmptyState, gbp, StatTile } from "@/components/ui";
import { getPriceLens } from "@/lib/queries";

/** Bars are clamped so one wild outlier doesn't flatten every other row. */
const MAX_GAP = 30;

export default async function PriceLensPage() {
  const lens = await getPriceLens();

  const header = (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Price lens</h1>
      <p className="mt-1 text-sm text-ink-2">A1&apos;s price against the cheapest competitor found for the same product.</p>
    </div>
  );

  if (lens.compared === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="No competitor prices yet">
          <p>
            Add hand-matched competitor pages to <Code>data/competitor-urls.csv</Code>, run <Code>npm run prices:import</Code>, then{" "}
            <Code>npm run prices</Code>. With eBay API keys in <Code>.env</Code>, every product with a GTIN is also checked on eBay UK automatically.
          </p>
          {lens.failedChecks > 0 && (
            <p className="mt-3">
              {lens.failedChecks} check(s) returned no price
              {lens.blockedRetailers.length > 0 && ` — ${lens.blockedRetailers.join(", ")} refuse automated requests, which A1 Lens respects`}.
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Products compared" value={String(lens.compared)} />
        <StatTile label="A1 is cheapest" value={`${Math.round((lens.a1Cheapest / lens.compared) * 100)}%`} hint={`${lens.a1Cheapest} of ${lens.compared} products`} />
        <StatTile
          label="Median gap"
          value={lens.medianGapPct == null ? "—" : `${lens.medianGapPct > 0 ? "+" : "−"}${Math.abs(lens.medianGapPct).toFixed(1)}%`}
          hint="A1 vs cheapest competitor; negative means A1 is cheaper"
        />
        <StatTile label="Checks without a price" value={String(lens.failedChecks)} hint={lens.blockedRetailers.length ? `blocked by: ${lens.blockedRetailers.join(", ")}` : "blocked, not found or no markup"} />
      </div>

      <Card title="A1 price vs cheapest competitor" subtitle="Most undercut first. Bars are capped at ±30%.">
        <div className="mb-3 flex gap-5 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />A1 is cheaper</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-negative" />Competitor is cheaper</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-muted">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 text-right font-medium">A1</th>
                <th className="pb-2 pl-6 font-medium">Cheapest competitor</th>
                <th className="w-56 pb-2 text-center font-medium">Gap</th>
                <th className="pb-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {lens.rows.map((r) => {
                const width = (Math.min(Math.abs(r.gapPct), MAX_GAP) / MAX_GAP) * 50;
                const undercut = r.gapPct > 0;
                return (
                  <tr key={r.productId} className="border-b border-hairline last:border-0">
                    <td className="max-w-sm py-2.5 pr-4">
                      <Link href={`/listings/${r.productId}`} className="line-clamp-1 text-ink hover:text-accent hover:underline">{r.name ?? r.slug}</Link>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{gbp(r.a1Price)}</td>
                    <td className="py-2.5 pl-6 text-ink-2">
                      <span className="tabular-nums text-ink">{gbp(r.cheapest.price)}</span> · {r.cheapest.retailer}
                    </td>
                    <td className="py-2.5">
                      {/* Diverging bar: grows left (A1 cheaper) or right (undercut) from a neutral centre line. */}
                      <div className="tip relative h-3" data-tip={`A1 ${gbp(r.a1Price)} vs ${r.cheapest.retailer} ${gbp(r.cheapest.price)}`} tabIndex={0}>
                        <div className="absolute inset-y-[-3px] left-1/2 w-px bg-axis" />
                        <div
                          className={`absolute inset-y-0 ${undercut ? "left-1/2 rounded-r-[4px] bg-negative" : "right-1/2 rounded-l-[4px] bg-accent"}`}
                          style={{ width: `${Math.max(width, 0.5)}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{undercut ? "+" : "−"}{Math.abs(r.gapPct).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
