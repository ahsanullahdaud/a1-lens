import Link from "next/link";
import { Card, Code, EmptyState, pct, ScoreMeter, SeverityBadge, ShareBar, StatTile } from "@/components/ui";
import { SEGMENTS } from "@/lib/audit/segment";
import { getOverview, isSegment } from "@/lib/queries";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const requested = first((await searchParams).segment);
  const segment = isSegment(requested) ? requested : undefined;
  const data = await getOverview(segment);

  if (!data.allAudited) {
    return (
      <EmptyState title="No listings audited yet">
        Start Postgres with <Code>npm run db:up</Code>, apply the schema with <Code>npm run db:migrate</Code>, then run{" "}
        <Code>npm run crawl</Code> to audit your first 25 product pages.
      </EmptyState>
    );
  }

  const maxBucket = Math.max(...data.histogram.map((b) => b.n), 1);
  const scopeLabel = segment ? SEGMENTS.find((s) => s.id === segment)?.label : "Whole catalogue";
  const listingsHref = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries({ segment, ...params } as Record<string, string | undefined>).filter((e): e is [string, string] => Boolean(e[1])));
    return `/listings?${qs}`;
  };

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

      {/* One filter row above everything it affects. Plain GET form, no client JS needed. */}
      <form className="flex flex-wrap items-end gap-3 text-sm" action="/">
        <label className="flex flex-col gap-1 text-ink-2">
          Segment
          <select name="segment" defaultValue={segment ?? ""} className="w-56 rounded-md border border-hairline bg-surface px-3 py-1.5 text-ink">
            <option value="">Whole catalogue</option>
            {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-ink px-4 py-1.5 font-medium text-surface">Apply</button>
        {segment && <Link href="/" className="py-1.5 text-ink-2 hover:text-ink">Clear</Link>}
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={`Listings audited · ${scopeLabel}`} value={data.listings.toLocaleString("en-GB")} hint={segment ? `of ${data.allAudited.toLocaleString("en-GB")} audited` : "of ~1,000 in the sitemap"} />
        <StatTile label="Average score" value={`${data.avgScore ?? "—"}`} hint="out of 100" />
        <StatTile label="Findings" value={data.findings.toLocaleString("en-GB")} hint={data.listings ? `${(data.findings / data.listings).toFixed(1)} per listing` : undefined} />
        <StatTile label="Listings with a high-severity issue" value={data.listingsWithHigh.toLocaleString("en-GB")} hint={data.listings ? `${pct(data.listingsWithHigh / data.listings)} of ${scopeLabel?.toLowerCase()}` : undefined} />
      </div>

      {!segment && (
        <Card
          title="Catalogue segments"
          subtitle="Listings grouped by the import signature they share, so one root cause reads as one job."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Segment</th>
                  <th className="w-52 pb-2 font-medium">Share of catalogue</th>
                  <th className="pb-2 text-right font-medium">Listings</th>
                  <th className="pb-2 pl-6 font-medium">Avg score</th>
                </tr>
              </thead>
              <tbody>
                {data.segments.map((s) => (
                  <tr key={s.id} className="border-b border-hairline align-top last:border-0">
                    <td className="max-w-md py-2.5 pr-4">
                      <Link href={`/?segment=${s.id}`} className="font-medium text-ink hover:text-accent hover:underline">{s.label}</Link>
                      <p className="mt-0.5 text-xs text-ink-2">{s.description}</p>
                    </td>
                    <td className="py-3 pr-4"><ShareBar share={s.share} tip={`${s.n} of ${data.allAudited} listings`} /></td>
                    <td className="py-2.5 text-right tabular-nums text-ink">
                      <Link href={listingsHref({ segment: s.id })} className="hover:text-accent hover:underline">{s.n}</Link> <span className="text-muted">({pct(s.share)})</span>
                    </td>
                    <td className="py-2.5 pl-6"><ScoreMeter score={s.avgScore} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm">
            <Link href="/feed-quality" className="text-accent hover:underline">Feed quality: the thin import as one problem →</Link>
          </p>
        </Card>
      )}

      <Card
        title={`Findings by rule · ${scopeLabel}`}
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
                    <Link href={listingsHref({ rule: rule.id })} className="text-ink hover:text-accent hover:underline">
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
