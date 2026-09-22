import Link from "next/link";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/audit/rules";

export const gbp = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);

export const pct = (share: number) => `${Math.round(share * 100)}%`;

export function Card({ title, subtitle, children, className = "" }: { title?: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-hairline bg-surface p-5 ${className}`}>
      {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
      {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** Stat tile: sentence-case label, proportional-figure value, optional context line. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const SEVERITY: Record<Severity, { label: string; icon: string; color: string }> = {
  high: { label: "High", icon: "▲", color: "text-status-critical" },
  medium: { label: "Medium", icon: "◆", color: "text-status-serious" },
  low: { label: "Low", icon: "●", color: "text-muted" },
};

/** Status is never colour-alone: a distinct shape per level plus a text label in ink. */
export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  const s = SEVERITY[severity];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
      <span aria-hidden className={`text-[10px] ${s.color}`}>{s.icon}</span>
      {count != null ? `${count} ${s.label.toLowerCase()}` : s.label}
    </span>
  );
}

/** Meter: accent fill on a lighter step of the same ramp. */
export function ScoreMeter({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-7 text-right text-sm font-medium tabular-nums text-ink">{score}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-accent-track" role="img" aria-label={`Audit score ${score} out of 100`}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}

/** Thin horizontal bar: square at the baseline, 4px rounded data-end. */
export function ShareBar({ share, tip }: { share: number; tip: string }) {
  return (
    <span className="tip block h-3 w-full" data-tip={tip} tabIndex={0}>
      <span className="block h-full rounded-r-[4px] bg-accent" style={{ width: `${Math.max(share * 100, 1)}%` }} />
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-axis bg-surface p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      <div className="mx-auto mt-2 max-w-xl text-sm text-ink-2">{children}</div>
    </div>
  );
}

export const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-neutral px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
);

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  const link = "rounded-md border border-hairline px-3 py-1.5 text-ink hover:border-axis";
  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-ink-2" aria-label="Pagination">
      {page > 1 ? <Link className={link} href={hrefFor(page - 1)}>← Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className={link} href={hrefFor(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
