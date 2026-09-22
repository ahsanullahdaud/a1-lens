import type { ParsedProduct } from "../crawler/parse-product";
import { SEVERITY_WEIGHT } from "./config";
import { RULES, type Severity } from "./rules";

export type Finding = { ruleId: string; severity: Severity; message: string; evidence?: string };
export type AuditResult = { score: number; findings: Finding[] };

/** Run every rule against one parsed page. Score is 100 minus a penalty per finding. */
export function auditProduct(snapshot: ParsedProduct, now = new Date()): AuditResult {
  // Snapshots stored before a parser change lack newer fields; default them so
  // `npm run audit` keeps working until those pages are re-crawled.
  const product: ParsedProduct = { ...snapshot, specs: snapshot.specs ?? [], conditionVariants: snapshot.conditionVariants ?? [] };
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const hit = rule.check(product, { now });
    if (hit) findings.push({ ruleId: rule.id, severity: rule.severity, ...hit });
  }
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return { score: Math.max(0, 100 - penalty), findings };
}
