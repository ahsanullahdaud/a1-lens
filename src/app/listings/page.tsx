import Link from "next/link";
import { Card, EmptyState, gbp, Pagination, ScoreMeter, SeverityBadge } from "@/components/ui";
import { RULES, RULES_BY_ID } from "@/lib/audit/rules";
import { getListings } from "@/lib/queries";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ListingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = { rule: first(params.rule), severity: first(params.severity), q: first(params.q) };
  const page = Math.max(1, Number(first(params.page)) || 1);
  const { rows, total, pages } = await getListings({ ...filters, page });
  const activeRule = filters.rule ? RULES_BY_ID.get(filters.rule) : undefined;

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams(Object.entries({ ...filters, page: String(p) }).filter((e): e is [string, string] => Boolean(e[1])));
    return `/listings?${qs}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Listings</h1>
        <p className="mt-1 text-sm text-ink-2">{total.toLocaleString("en-GB")} listing(s), worst score first.</p>
      </div>

      {/* One filter row above the table; a plain GET form, so it works without client JS. */}
      <form className="flex flex-wrap items-end gap-3 text-sm" action="/listings">
        <label className="flex flex-col gap-1 text-ink-2">
          Search
          <input name="q" defaultValue={filters.q} placeholder="Name, brand or SKU" className="w-56 rounded-md border border-hairline bg-surface px-3 py-1.5 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-ink-2">
          Rule
          <select name="rule" defaultValue={filters.rule ?? ""} className="w-72 rounded-md border border-hairline bg-surface px-3 py-1.5 text-ink">
            <option value="">Any rule</option>
            {RULES.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-ink-2">
          Severity
          <select name="severity" defaultValue={filters.severity ?? ""} className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-ink">
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <button className="rounded-md bg-ink px-4 py-1.5 font-medium text-surface">Apply</button>
        {(filters.q || filters.rule || filters.severity) && <Link href="/listings" className="py-1.5 text-ink-2 hover:text-ink">Clear</Link>}
      </form>

      {activeRule && (
        <Card title={activeRule.title}>
          <div className="space-y-2 text-sm text-ink-2">
            <p><SeverityBadge severity={activeRule.severity} /> <span className="ml-2">{activeRule.category}</span></p>
            <p><span className="font-medium text-ink">Why it matters. </span>{activeRule.why}</p>
            <p><span className="font-medium text-ink">Fix. </span>{activeRule.fix}</p>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No listings match">Try clearing a filter, or crawl more pages with npm run crawl.</EmptyState>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Listing</th>
                  <th className="pb-2 font-medium">Condition</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 pl-6 font-medium">Findings</th>
                  <th className="pb-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="max-w-md py-2.5 pr-4">
                      <Link href={`/listings/${p.id}`} className="line-clamp-1 text-ink hover:text-accent hover:underline">{p.name ?? p.slug}</Link>
                      <span className="text-xs text-muted">{p.brand}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2">{p.conditionLabel ?? "—"}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{gbp(p.price)}</td>
                    <td className="py-2.5 pl-6">
                      <span className="flex flex-wrap gap-x-3">
                        {p.high > 0 && <SeverityBadge severity="high" count={p.high} />}
                        {p.medium > 0 && <SeverityBadge severity="medium" count={p.medium} />}
                        {p.low > 0 && <SeverityBadge severity="low" count={p.low} />}
                      </span>
                    </td>
                    <td className="py-2.5"><ScoreMeter score={p.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} hrefFor={hrefFor} />
        </Card>
      )}
    </div>
  );
}
