/**
 * Re-run the audit rules over stored snapshots — no network needed.
 * Use this after editing src/lib/audit/rules.ts or config.ts.
 *
 *   npm run audit
 */
import "dotenv/config";
import { isNotNull } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { saveAudit } from "../src/lib/store";

async function main() {
  const rows = await db
    .select({ id: schema.products.id, snapshot: schema.products.snapshot })
    .from(schema.products)
    .where(isNotNull(schema.products.snapshot));

  const perRule = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const { score, findings } = await saveAudit(row.id, row.snapshot!);
    total += score;
    for (const f of findings) perRule.set(f.ruleId, (perRule.get(f.ruleId) ?? 0) + 1);
  }

  console.log(`Audited ${rows.length} listing(s). Average score: ${rows.length ? Math.round(total / rows.length) : "—"}\n`);
  for (const [ruleId, count] of [...perRule].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${ruleId}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
