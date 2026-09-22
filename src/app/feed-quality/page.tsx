import Link from "next/link";
import { Card, EmptyState, pct, ScoreMeter, ShareBar, StatTile } from "@/components/ui";
import { SEGMENT_BY_ID } from "@/lib/audit/segment";
import { getFeedQuality } from "@/lib/queries";

export default async function FeedQualityPage() {
  const feed = await getFeedQuality();
  const thin = SEGMENT_BY_ID.get("thin-feed")!;
  const noCopy = SEGMENT_BY_ID.get("no-copy")!;

  if (feed.thinN === 0) {
    return (
      <EmptyState title="No thin-feed listings detected">
        Nothing audited so far shows the import signature. {thin.description}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Feed quality</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          {pct(feed.thinShare)} of the catalogue shares one signature. {thin.description} Treated as one import to enrich rather than{" "}
          {feed.thinN} separate listings to fix.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Thin-feed listings" value={feed.thinN.toLocaleString("en-GB")} hint={`${pct(feed.thinShare)} of ${feed.total.toLocaleString("en-GB")} audited`} />
        <StatTile label="Average score, thin feed" value={`${feed.thinAvgScore ?? "—"}`} hint={`vs ${feed.standardAvgScore ?? "—"} for standard listings`} />
        <StatTile label="Have a GTIN / EAN" value={pct(feed.thinN ? feed.thinWithGtin / feed.thinN : 0)} hint="the key that makes bulk enrichment possible" />
        <StatTile label="Images but no copy" value={feed.noCopyN.toLocaleString("en-GB")} hint={`a second, smaller import · avg score ${feed.noCopyAvgScore ?? "—"}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What the thin-feed listings are missing" subtitle="The three defining signals hold for every listing in the segment; the rest are what else comes with them.">
          <ul className="mb-4 space-y-1 text-sm text-ink-2">
            {feed.signature.map((s) => (
              <li key={s.label} className="flex justify-between gap-4">
                <span>{s.label}</span>
                <span className="tabular-nums text-muted">{s.n} · by definition</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-3 text-sm">
            {feed.signals.map((s) => (
              <li key={s.label}>
                <div className="mb-1 flex justify-between gap-4">
                  <span className="text-ink">{s.label}</span>
                  <span className="tabular-nums text-ink-2">{s.n} <span className="text-muted">({pct(s.share)})</span></span>
                </div>
                <ShareBar share={s.share} tip={`${s.n} of ${feed.thinN} listings`} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="How to fix it as one job" subtitle="Options in rough order of effort.">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
            <li>
              <span className="font-medium text-ink">Enrich by EAN.</span> {pct(feed.thinN ? feed.thinWithGtin / feed.thinN : 0)} of these listings carry a barcode, so a
              product-data service (manufacturer feeds, Icecat-style catalogues) can supply specs, images and copy in bulk.
            </li>
            <li>
              <span className="font-medium text-ink">Ask the supplier for the full feed.</span> The brand + EAN spec table means the import took the feed&apos;s
              identifiers and dropped everything else — the richer fields probably exist upstream.
            </li>
            <li>
              <span className="font-medium text-ink">Fix names and URLs in the importer.</span> Cut-off names, brand-less names and “…-2” URLs are import-time
              defects; one change to the mapping prevents the next batch repeating them.
            </li>
            <li>
              <span className="font-medium text-ink">Draft copy with an LLM, review by hand.</span> For what no feed covers: a 150-character meta description and a
              short description from brand, name and EAN — for a person to approve, not to auto-publish.
            </li>
          </ol>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Where it sits" subtitle="Thin-feed share of each top-level category.">
          <table className="w-full text-sm">
            <tbody>
              {feed.byCategory.map((c) => (
                <tr key={c.name} className="border-b border-hairline last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/listings?segment=thin-feed&category=${encodeURIComponent(c.name)}`} className="text-ink hover:text-accent hover:underline">{c.name}</Link>
                  </td>
                  <td className="w-40 py-2"><ShareBar share={c.share} tip={`${c.thinFeed} of ${c.n}`} /></td>
                  <td className="py-2 pl-3 text-right tabular-nums text-ink">{c.thinFeed} <span className="text-muted">/ {c.n}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Which brands" subtitle="Brands with the most thin-feed listings; the bar is the brand's own thin share.">
          <table className="w-full text-sm">
            <tbody>
              {feed.byBrand.map((b) => (
                <tr key={b.brand} className="border-b border-hairline last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/listings?segment=thin-feed&q=${encodeURIComponent(b.brand)}`} className="text-ink hover:text-accent hover:underline">{b.brand}</Link>
                  </td>
                  <td className="w-40 py-2"><ShareBar share={b.share} tip={`${b.thinFeed} of ${b.n} ${b.brand} listings`} /></td>
                  <td className="py-2 pl-3 text-right tabular-nums text-ink">{b.thinFeed} <span className="text-muted">/ {b.n}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Examples" subtitle="The lowest-scoring thin-feed listings.">
        <ul className="divide-y divide-hairline text-sm">
          {feed.sample.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-2">
              <span className="min-w-0">
                <Link href={`/listings/${p.id}`} className="block truncate text-ink hover:text-accent hover:underline">{p.name ?? p.slug}</Link>
                <span className="text-xs text-muted">{p.brand}</span>
              </span>
              <ScoreMeter score={p.score} />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/listings?segment=thin-feed" className="text-accent hover:underline">All {feed.thinN} thin-feed listings →</Link>
          <span className="mx-2 text-muted">·</span>
          <Link href="/listings?segment=no-copy" className="text-accent hover:underline">{noCopy.label} ({feed.noCopyN}) →</Link>
        </p>
      </Card>
    </div>
  );
}
