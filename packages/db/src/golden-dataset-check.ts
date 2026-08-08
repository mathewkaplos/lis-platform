/**
 * TASK-026 (FEAT-007): golden-dataset test runner.
 *
 * Per the approved FEAT-007 proposal §1/§5, no range-resolution or flagging
 * service exists yet (TASK-049/050, M3) — so this runner validates the
 * *data* those future services will read from: it asserts the live
 * `reference_range` table matches each golden file below exactly, in both
 * directions (a row in the DB but not the golden file, or vice versa, is a
 * failure, not just a value mismatch). Each golden file mirrors its own
 * discipline's seed file rows 1:1, so this is also a standing regression
 * check that a seed and its "reviewed" dataset haven't silently drifted
 * apart.
 *
 * Generalized to a list of golden files by TASK-071 (FEAT-023) — originally
 * hard-coded to chemistry-ranges-criticals.json only (a real, load-bearing
 * gap found during TASK-071's own implementation, not anticipated when the
 * FEAT-023 proposal was drafted: this script, `apps/api/test/reference-
 * range-resolution.e2e-spec.ts`, `scripts/db-reset.sh`, and `pr.yml` all
 * separately hard-coded the single chemistry file/path). Add a new
 * discipline's golden file to `GOLDEN_FILES` below, not a second script.
 *
 * Same shape as rls-isolation-check.ts (TASK-024): a tsx script, not a
 * Vitest suite (no test framework exists in this repo yet — see proposal
 * §5), connected as `lis_app` (never `postgres`), PASS/FAIL console
 * reporting, non-zero exit on any failure.
 *
 * TASK-027's "reviewed and signed off by the design-partner lab" AC is
 * explicitly NOT asserted here — this runner only proves the golden file
 * and the live table agree, not that the values themselves are clinically
 * correct. That sign-off is tracked as a separate, open follow-up (see the
 * proposal's §10 resolution).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { analyte } from "./schema/catalog";

type Db = ReturnType<typeof createDb>;

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set (must connect as lis_app, not postgres)");
}

// Same fixed seed/demo tenant as rls-isolation-check.ts and
// db/seed/chemistry-catalog.sql — duplicated here rather than imported,
// since rls-isolation-check.ts doesn't export it and this proposal's scope
// doesn't include refactoring that already-merged file.
const TENANT_A = "00000000-0000-0000-0000-000000000001";

interface GoldenEntry {
  analyte: string;
  sex: string | null;
  condition: string | null;
  rangeType: string;
  low: number | null;
  high: number | null;
  source?: string;
}

interface GoldenFile {
  _meta: unknown;
  entries: GoldenEntry[];
}

interface LiveRow extends Record<string, unknown> {
  sex: string | null;
  condition: string | null;
  range_type: string;
  low: string | null;
  high: string | null;
}

async function setTenant(db: Db, tenantId: string) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
}

const GOLDEN_FILES = ["chemistry-ranges-criticals.json", "haematology-ranges-criticals.json"];

function loadGoldenFile(filename: string): GoldenEntry[] {
  const path = join(__dirname, "../../../db/golden", filename);
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as GoldenFile;
  return parsed.entries;
}

function entryKey(e: { analyte: string; sex: string | null; condition: string | null; rangeType: string; low: number | string | null; high: number | string | null }): string {
  const low = e.low === null ? "null" : Number(e.low);
  const high = e.high === null ? "null" : Number(e.high);
  return `${e.analyte}|${e.sex ?? "null"}|${e.condition ?? "null"}|${e.rangeType}|${low}|${high}`;
}

async function fetchLiveRows(db: Db, analyteDisplay: string): Promise<LiveRow[]> {
  const result = await db.execute<LiveRow>(sql`
    SELECT rr.sex, rr.condition, rr.range_type, rr.low::text AS low, rr.high::text AS high
    FROM reference_range rr
    JOIN analyte a ON a.id = rr.analyte_id
    WHERE a.display = ${analyteDisplay}
  `);
  return result.rows;
}

async function main() {
  const db = createDb(APP_DATABASE_URL);
  await setTenant(db, TENANT_A);

  console.log(`TASK-026/071: golden-dataset check (${GOLDEN_FILES.length} file(s), connected as lis_app)\n`);
  console.log(
    "NOTE: this proves each golden file and the live reference_range table agree — it does NOT prove\n" +
      "the values themselves are clinically correct. Design-partner sign-off is a separate, open item.\n",
  );

  const failures: string[] = [];
  let totalAnalytes = 0;
  let totalGoldenEntries = 0;
  let totalLiveRows = 0;

  for (const file of GOLDEN_FILES) {
    const goldenEntries = loadGoldenFile(file);
    const analyteNames = [...new Set(goldenEntries.map((e) => e.analyte))];

    const goldenKeys = new Set(goldenEntries.map(entryKey));
    const liveKeys = new Set<string>();

    for (const name of analyteNames) {
      const [row] = await db.select({ id: analyte.id }).from(analyte).where(sql`${analyte.display} = ${name}`).limit(1);
      if (!row) {
        failures.push(`[${file}] ${name}: no analyte row found in the catalog at all — run \`pnpm db:reset\` first`);
        continue;
      }
      const liveRows = await fetchLiveRows(db, name);
      for (const r of liveRows) {
        liveKeys.add(
          entryKey({
            analyte: name,
            sex: r.sex,
            condition: r.condition,
            rangeType: r.range_type,
            low: r.low === null ? null : Number(r.low),
            high: r.high === null ? null : Number(r.high),
          }),
        );
      }
    }

    for (const key of goldenKeys) {
      if (!liveKeys.has(key)) {
        failures.push(`[${file}] in golden dataset but not in DB: ${key}`);
      }
    }
    for (const key of liveKeys) {
      if (!goldenKeys.has(key)) {
        failures.push(`[${file}] in DB but not in golden dataset: ${key}`);
      }
    }

    totalAnalytes += analyteNames.length;
    totalGoldenEntries += goldenEntries.length;
    totalLiveRows += liveKeys.size;
  }

  console.log(`Checked ${totalAnalytes} analyte(s), ${totalGoldenEntries} golden entries, ${totalLiveRows} live rows across ${GOLDEN_FILES.length} file(s).\n`);

  if (failures.length > 0) {
    failures.forEach((f) => console.error(`FAIL: ${f}`));
    console.error(`\n${failures.length} mismatch(es). See above.`);
    process.exit(1);
  }

  console.log("PASS: every golden dataset and the live reference_range table agree exactly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
