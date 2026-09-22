import Link from "next/link";
import { Card, Code, EmptyState, pct, ScoreMeter, SeverityBadge, ShareBar, StatTile } from "@/components/ui";
import { getOverview } from "@/lib/queries";

export default async function OverviewPage() {
  const data = await getOverview();

  if (!data.listings) {
    return (
      <EmptyState title="No listings audited yet">
        Start Postgres with <Code>npm run db:up</Code>, apply the schema with <Code>npm run db:migrate</Code>, then run{" "}
        <Code>npm run crawl</Code> to audit your first 25 product pages.
      </EmptyState>
    );
  }

  const maxBucket = Math.max(...data.histogram.map((b) => b.n), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Listing quality</h1>
        <p className="mt-1 text-sm text-ink-2">
          {data.lastRun?.finishedAt
            ? `Last crawl finished ${data.lastRun.finishedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${data.lastRun.pagesFetched} page(s) fetched, ${data.lastRun.pagesFailed} failed`
            : "A crawl is in progress or did not finish."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Listings audited" value={data.listings.toLocaleString("en-GB")} hint="of ~1,000 in the sitemap" />
        <StatTile label="Average score" value={`${data.avgScore ?? "—"}`} hint="out of 100" />
        <StatTile label="Findings" value={data.findings.toLocaleString("en-GB")} hint={`${(data.findings / data.listings).toFixed(1)} per listing`} />
        <StatTile label="Listings with a high-severity issue" value={data.listingsWithHigh.toLocaleString("en-GB")} hint={`${pct(data.listingsWithHigh / data.listings)} of audited listings`} />
      </div>

      <Card
        title="Findings by rule"
        subtitle="A rule that hits nearly every listing is a template fix: one code change clears it everywhere. A rule that hits a few is a content fix."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-muted">
                <th className="pb-2 font-medium">Rule</th>
                <th className="pb-2 font-medium">Severity</th>
                <th className="pb-2 font-medium">Area</th>
                <th className="w-52 pb-2 font-medium">Share of listings</th>
                <th className="pb-2 text-right font-medium">Listings</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map(({ rule, affected, share }) => (
                <tr key={rule.id} className="border-b border-hairline last:border-0">
                  <td className="py-2.5 pr-4">
                    <Link href={`/listings?rule=${rule.id}`} className="text-ink hover:text-accent hover:underline">
                      {rule.title}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4"><SeverityBadge severity={rule.severity} /></td>
                  <td className="py-2.5 pr-4 text-ink-2">{rule.category}</td>
                  <td className="py-2.5 pr-4"><ShareBar share={share} tip={`${affected} of ${data.listings} listings`} /></td>
                  <td className="py-2.5 text-right tabular-nums text-ink">
                    {affected} <span className="text-muted">({pct(share)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Score distribution" subtitle="Number of listings in each audit-score band.">
          <figure>
            <div className="flex h-36 items-end gap-0.5 border-b border-axis" aria-hidden>
              {data.histogram.map((b) => (
                <div key={b.bucket} className="tip flex h-full flex-1 items-end justify-center" data-tip={`${b.label}: ${b.n} listing${b.n === 1 ? "" : "s"}`} tabIndex={0}>
                  <div className="w-full max-w-6 rounded-t-[4px] bg-accent" style={{ height: `${(b.n / maxBucket) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-0.5 text-[11px] tabular-nums text-muted" aria-hidden>
              {data.histogram.map((b) => (
                <span key={b.bucket} className="flex-1 text-center">{b.bucket * 10}</span>
              ))}
            </div>
            <table className="sr-only">
              <caption>Listings per audit-score band</caption>
              <tbody>
                {data.histogram.map((b) => (
                  <tr key={b.bucket}><th scope="row">{b.label}</th><td>{b.n}</td></tr>
                ))}
              </tbody>
            </table>
          </figure>
        </Card>

        <Card title="Lowest-scoring listings" subtitle="Where a content fix would move the needle most.">
          <ul className="divide-y divide-hairline text-sm">
            {data.worst.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-2">
                <Link href={`/listings/${p.id}`} className="truncate text-ink hover:text-accent hover:underline">
                  {p.name ?? p.slug}
                </Link>
                <ScoreMeter score={p.score} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
