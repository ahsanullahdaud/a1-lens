import Link from "next/link";
import { Card, Code, EmptyState, gbp, StatTile } from "@/components/ui";
import { getPriceLens, type PriceLensProduct, type PriceObservationRow } from "@/lib/queries";

/** Bars are clamped so one wild outlier doesn't flatten every other row. */
const MAX_GAP = 35;

const SOURCE_LABEL: Record<string, string> = { parallel: "Parallel Extract", url: "page markup", ebay: "eBay API" };
const MATCH_STYLE: Record<string, string> = {
  exact: "bg-neutral text-ink",
  near: "bg-status-serious/15 text-ink",
  uncertain: "bg-status-warning/20 text-ink",
};

const fetched = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const stockLabel = (s: string | null) => (s ?? "unknown").replace(/_/g, " ");

function MatchBadge({ match, note }: { match: string | null; note: string | null }) {
  const m = match ?? "unknown";
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${MATCH_STYLE[m] ?? "bg-neutral text-ink"}`}>{m}</span>
      {note && <span className="text-xs text-ink-2">{note}</span>}
    </span>
  );
}

function Headline({ p }: { p: PriceLensProduct }) {
  const named = p.retailersChecked.join(", ");
  if (!p.cheapest) {
    const nearest = p.observations.find((o) => o.status === "ok" && o.price != null);
    return (
      <p className="text-sm text-ink-2">
        No exact or uncertain match with a price among {p.retailersChecked.length} retailer{p.retailersChecked.length === 1 ? "" : "s"} checked ({named}).
        {nearest && <> Nearest is a <em>near</em> match: {gbp(nearest.price)} at {nearest.retailer}.</>}
      </p>
    );
  }
  const dearer = (p.gap ?? 0) > 0;
  return (
    <p className="text-sm text-ink">
      <span className="text-ink-2">Cheapest of {p.retailersChecked.length} retailer{p.retailersChecked.length === 1 ? "" : "s"} checked ({named}):</span>{" "}
      <span className="font-medium">{p.cheapest.retailer} {gbp(p.cheapest.price)}</span>
      {p.cheapest.match === "uncertain" && <span className="text-ink-2"> (uncertain match)</span>}
      {p.gap != null && (
        <>
          {" "}
          — A1 is <span className={`font-semibold ${dearer ? "text-status-critical" : ""}`}>{dearer ? "dearer" : "cheaper"} by {gbp(Math.abs(p.gap))} ({Math.abs(p.gapPct!).toFixed(0)}%)</span>
        </>
      )}
    </p>
  );
}

function GapBar({ gapPct }: { gapPct?: number }) {
  if (gapPct == null) return <div className="h-3" />;
  const width = (Math.min(Math.abs(gapPct), MAX_GAP) / MAX_GAP) * 50;
  const dearer = gapPct > 0;
  return (
    <div className="tip relative h-3 w-full" data-tip={`${dearer ? "+" : "−"}${Math.abs(gapPct).toFixed(1)}% vs cheapest comparable`} tabIndex={0}>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-axis" />
      <div className={`absolute inset-y-0 ${dearer ? "left-1/2 rounded-r-[4px] bg-negative" : "right-1/2 rounded-l-[4px] bg-accent"}`} style={{ width: `${Math.max(width, 0.5)}%` }} />
    </div>
  );
}

function ObservationRow({ o, a1Price }: { o: PriceObservationRow; a1Price: number | null }) {
  const ok = o.status === "ok" && o.price != null;
  const delivery = o.shippingCost == null ? "not stated" : o.shippingCost === 0 ? "free" : gbp(o.shippingCost);
  const diff = ok && a1Price != null ? a1Price - o.price! : null;
  return (
    <tr className="border-b border-hairline align-top last:border-0 [&>td]:px-3 [&>td:first-child]:pl-0 [&>td:last-child]:pr-0">
      <td className="py-2">
        {o.url ? (
          <a href={o.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent hover:underline">{o.retailer} ↗</a>
        ) : (
          <span className="text-ink">{o.retailer}</span>
        )}
        {o.title && <div className="max-w-xs truncate text-xs text-muted">{o.title}</div>}
      </td>
      <td className="whitespace-nowrap py-2 text-right tabular-nums">
        {ok ? (
          <>
            <div className="text-ink">{gbp(o.price)}</div>
            <div className="text-xs text-muted">
              {o.shippingCost ? `${gbp(o.itemPrice)} + ${gbp(o.shippingCost)} delivery` : `delivery ${delivery}`}
            </div>
          </>
        ) : (
          <span className="text-muted">{o.status === "no_price" ? "no price" : o.status.replace(/_/g, " ")}</span>
        )}
      </td>
      <td className="whitespace-nowrap py-2 text-right tabular-nums text-ink-2">{gbp(o.wasPrice)}</td>
      <td className="whitespace-nowrap py-2 text-right tabular-nums">
        {diff == null ? <span className="text-muted">—</span> : <span className={diff > 0 ? "font-medium text-status-critical" : "text-ink"}>{diff > 0 ? "+" : "−"}{gbp(Math.abs(diff))}</span>}
      </td>
      <td className="whitespace-nowrap py-2 text-ink-2">{stockLabel(o.availability)}</td>
      <td className="max-w-md py-2"><MatchBadge match={o.match} note={o.matchNote} /></td>
      <td className="whitespace-nowrap py-2 text-xs text-ink-2">
        {SOURCE_LABEL[o.source] ?? o.source}
        <div className="text-muted">{fetched(o.capturedAt)}</div>
      </td>
    </tr>
  );
}

export default async function PriceLensPage() {
  const lens = await getPriceLens();

  const header = (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Price lens</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        A1&apos;s price against every competitor page we have checked for the same product. The headline gap uses the cheapest <em>exact</em> or <em>uncertain</em> match;
        <em> near</em> matches (a different colour, capacity or bundle) are listed but never set the gap. Products where A1 is dearer come first.
      </p>
    </div>
  );

  if (lens.rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="No competitor prices yet">
          Add hand-matched competitor pages to <Code>data/competitor-urls.csv</Code>, run <Code>npm run prices:import</Code>, then <Code>npm run extract</Code> or{" "}
          <Code>npm run prices</Code>.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Products compared" value={String(lens.compared)} hint={lens.lastFetched ? `latest check ${fetched(lens.lastFetched)}` : undefined} />
        <StatTile label="A1 is cheapest" value={lens.compared ? `${Math.round((lens.a1Cheapest / lens.compared) * 100)}%` : "—"} hint={`${lens.a1Cheapest} of ${lens.compared} products`} />
        <StatTile label="A1 is dearer" value={String(lens.a1Dearer)} hint={lens.a1Dearer ? "shown first below" : "no product undercut"} />
        <StatTile
          label="Median gap"
          value={lens.medianGapPct == null ? "—" : `${lens.medianGapPct > 0 ? "+" : "−"}${Math.abs(lens.medianGapPct).toFixed(1)}%`}
          hint="A1 vs cheapest comparable; negative = A1 cheaper"
        />
      </div>

      <div className="flex gap-5 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />A1 is cheaper</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-negative" />A1 is dearer</span>
        <span className="inline-flex items-center gap-1.5"><span className={`rounded px-1 ${MATCH_STYLE.exact}`}>exact</span><span className={`rounded px-1 ${MATCH_STYLE.uncertain}`}>uncertain</span><span className={`rounded px-1 ${MATCH_STYLE.near}`}>near</span> match quality</span>
      </div>

      {lens.rows.map((p) => (
        <Card key={p.productId}>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <Link href={`/listings/${p.productId}`} className="text-base font-semibold text-ink hover:text-accent hover:underline">{p.name ?? p.slug}</Link>
              <div className="mt-0.5 text-xs text-muted">
                A1 {gbp(p.a1Price)}{p.a1WasPrice ? ` (was ${gbp(p.a1WasPrice)})` : ""}{p.conditionLabel ? ` · ${p.conditionLabel}` : ""}
              </div>
              <div className="mt-2"><Headline p={p} /></div>
            </div>
            <div className="w-56 shrink-0 pt-1"><GapBar gapPct={p.gapPct} /></div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-muted [&>th]:whitespace-nowrap [&>th]:px-3 [&>th:first-child]:pl-0 [&>th:last-child]:pr-0">
                  <th className="pb-1.5 font-medium">Retailer</th>
                  <th className="pb-1.5 text-right font-medium">Price (landed)</th>
                  <th className="pb-1.5 text-right font-medium">Was</th>
                  <th className="pb-1.5 text-right font-medium">A1 vs this</th>
                  <th className="pb-1.5 font-medium">Stock</th>
                  <th className="pb-1.5 font-medium">Match</th>
                  <th className="pb-1.5 font-medium">Source · fetched</th>
                </tr>
              </thead>
              <tbody>
                {p.observations.map((o) => <ObservationRow key={o.id} o={o} a1Price={p.a1Price} />)}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {lens.failedChecks > 0 && (
        <p className="text-xs text-muted">
          {lens.failedChecks} check(s) returned no price{lens.blockedRetailers.length ? ` — ${lens.blockedRetailers.join(", ")} refuse automated requests, which A1 Lens respects` : ""}.
        </p>
      )}
    </div>
  );
}
