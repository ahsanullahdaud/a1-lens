/**
 * Re-run the audit rules and segment classifier over stored snapshots — no network needed.
 * Use this after editing anything in src/lib/audit/.
 *
 *   npm run audit
 */
import "dotenv/config";
import { isNotNull } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { saveAudit } from "../src/lib/store";

const tally = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

async function main() {
  const rows = await db
    .select({ id: schema.products.id, snapshot: schema.products.snapshot })
    .from(schema.products)
    .where(isNotNull(schema.products.snapshot));

  const perRule = new Map<string, number>();
  const perSegment = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const { score, findings, segment } = await saveAudit(row.id, row.snapshot!);
    total += score;
    tally(perSegment, segment);
    for (const f of findings) tally(perRule, f.ruleId);
  }

  console.log(`Audited ${rows.length} listing(s). Average score: ${rows.length ? Math.round(total / rows.length) : "—"}\n`);
  for (const [ruleId, count] of [...perRule].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${ruleId}`);
  }
  console.log("\nSegments:");
  for (const [segment, count] of [...perSegment].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${segment}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
