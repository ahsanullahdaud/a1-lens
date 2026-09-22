import Link from "next/link";
import { Card, EmptyState, pct, ScoreMeter, ShareBar } from "@/components/ui";
import { getCategoryScorecard } from "@/lib/queries";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const parent = first((await searchParams).parent);
  const { rows, templateWide } = await getCategoryScorecard(parent);

  const listingsHref = (name: string) => `/listings?category=${encodeURIComponent(parent ? `${parent} > ${name}` : name)}`;

  return (
    <div className="space-y-6">
      <div>
        {parent && <Link href="/categories" className="text-sm text-ink-2 hover:text-ink">← All categories</Link>}
        <h1 className="mt-2 text-2xl font-semibold text-ink">{parent ? `${parent}: sub-categories` : "Category scorecard"}</h1>
        <p className="mt-1 text-sm text-ink-2">
          Average audit score per category, how much of it is import-thin, and the issues specific to it.
          {templateWide.length > 0 && (
            <>
              {" "}
              Rules that hit the whole catalogue are left out of the “top issues” column: {templateWide.map((r) => r.title.toLowerCase()).join("; ")}.
            </>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No categories yet">Run npm run crawl to audit some listings first.</EmptyState>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Listings</th>
                  <th className="pb-2 pl-6 font-medium">Avg score</th>
                  <th className="w-44 pb-2 pl-6 font-medium">Import-thin share</th>
                  <th className="pb-2 pl-6 text-right font-medium">High-severity</th>
                  <th className="pb-2 pl-6 font-medium">Top issues (share of category)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const uncategorised = row.name === "Uncategorised";
                  return (
                    <tr key={row.name} className="border-b border-hairline align-top last:border-0">
                      <td className="py-2.5 pr-4">
                        {uncategorised ? (
                          <span className="text-ink">{row.name}</span>
                        ) : parent ? (
                          <Link href={listingsHref(row.name)} className="text-ink hover:text-accent hover:underline">{row.name}</Link>
                        ) : (
                          <Link href={`/categories?parent=${encodeURIComponent(row.name)}`} className="text-ink hover:text-accent hover:underline">{row.name}</Link>
                        )}
                        {!uncategorised && (
                          <Link href={listingsHref(row.name)} className="ml-2 text-xs text-muted hover:text-accent hover:underline">listings</Link>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-ink">{row.n}</td>
                      <td className="py-2.5 pl-6"><ScoreMeter score={row.avgScore} /></td>
                      <td className="py-2.5 pl-6">
                        <div className="flex items-center gap-2">
                          <ShareBar share={row.thinShare} tip={`${row.thinFeed} thin feed + ${row.noCopy} no-copy of ${row.n}`} />
                          <span className="w-10 text-right text-xs tabular-nums text-ink-2">{pct(row.thinShare)}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pl-6 text-right tabular-nums text-ink">{row.withHigh}</td>
                      <td className="py-2.5 pl-6 text-ink-2">
                        {row.topIssues.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {row.topIssues.map((issue) => (
                              <li key={issue.rule.id}>
                                <Link href={`/listings?rule=${issue.rule.id}&category=${encodeURIComponent(parent ? `${parent} > ${row.name}` : row.name)}`} className="hover:text-accent hover:underline">
                                  {issue.rule.title}
                                </Link>{" "}
                                <span className="tabular-nums text-muted">{pct(issue.share)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
