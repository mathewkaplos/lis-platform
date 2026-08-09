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
 *
 * Generalized to a second table shape by FEAT-025 (ADR-0023):
 * `delta_check_rule` has a genuinely different column set (no sex/age/
 * condition dimensions, one row per analyte) from `reference_range`, so
 * `GOLDEN_FILES` entries now carry an explicit `table` discriminator and the
 * fetch/key logic branches on it — same "add to the list, not a second
 * script" principle TASK-071 already established, extended to a second
 * table rather than only a second file of the same table's shape.
 *
 * Generalized to a third shape by FEAT-024 (ADR-0025): `analyte_catalog`
 * proves the seeded Peripheral Film morphology analytes exist with the
 * correct `data_type` (`'ordinal'`) — unlike `reference_range`/
 * `delta_check_rule`, this isn't a config table joined *from* `analyte`,
 * it's `analyte` itself, so its own "live rows" fetch reads `analyte`
 * directly rather than a second table.
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

interface ReferenceRangeGoldenEntry {
  analyte: string;
  sex: string | null;
  condition: string | null;
  rangeType: string;
  low: number | null;
  high: number | null;
  source?: string;
}

interface DeltaCheckGoldenEntry {
  analyte: string;
  thresholdPercent: number;
  source?: string;
}

interface AnalyteCatalogGoldenEntry {
  analyte: string;
  dataType: string;
}

interface GoldenFile<E> {
  _meta: unknown;
  entries: E[];
}

interface ReferenceRangeLiveRow extends Record<string, unknown> {
  sex: string | null;
  condition: string | null;
  range_type: string;
  low: string | null;
  high: string | null;
}

interface DeltaCheckLiveRow extends Record<string, unknown> {
  threshold_percent: string;
}

interface AnalyteCatalogLiveRow extends Record<string, unknown> {
  data_type: string;
}

type GoldenFileConfig =
  | { file: string; table: "reference_range" }
  | { file: string; table: "delta_check_rule" }
  | { file: string; table: "analyte_catalog" };

const GOLDEN_FILES: GoldenFileConfig[] = [
  { file: "chemistry-ranges-criticals.json", table: "reference_range" },
  { file: "haematology-ranges-criticals.json", table: "reference_range" },
  { file: "delta-check-thresholds.json", table: "delta_check_rule" },
  { file: "peripheral-film-morphology.json", table: "analyte_catalog" },
];

async function setTenant(db: Db, tenantId: string) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
}

function loadGoldenFile<E>(filename: string): E[] {
  const path = join(__dirname, "../../../db/golden", filename);
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as GoldenFile<E>;
  return parsed.entries;
}

function referenceRangeEntryKey(e: {
  analyte: string;
  sex: string | null;
  condition: string | null;
  rangeType: string;
  low: number | string | null;
  high: number | string | null;
}): string {
  const low = e.low === null ? "null" : Number(e.low);
  const high = e.high === null ? "null" : Number(e.high);
  return `${e.analyte}|${e.sex ?? "null"}|${e.condition ?? "null"}|${e.rangeType}|${low}|${high}`;
}

function deltaCheckEntryKey(e: { analyte: string; thresholdPercent: number | string }): string {
  return `${e.analyte}|${Number(e.thresholdPercent)}`;
}

function analyteCatalogEntryKey(e: { analyte: string; dataType: string }): string {
  return `${e.analyte}|${e.dataType}`;
}

async function fetchLiveReferenceRangeRows(db: Db, analyteDisplay: string): Promise<ReferenceRangeLiveRow[]> {
  const result = await db.execute<ReferenceRangeLiveRow>(sql`
    SELECT rr.sex, rr.condition, rr.range_type, rr.low::text AS low, rr.high::text AS high
    FROM reference_range rr
    JOIN analyte a ON a.id = rr.analyte_id
    WHERE a.display = ${analyteDisplay}
  `);
  return result.rows;
}

async function fetchLiveDeltaCheckRows(db: Db, analyteDisplay: string): Promise<DeltaCheckLiveRow[]> {
  const result = await db.execute<DeltaCheckLiveRow>(sql`
    SELECT d.threshold_percent::text AS threshold_percent
    FROM delta_check_rule d
    JOIN analyte a ON a.id = d.analyte_id
    WHERE a.display = ${analyteDisplay}
  `);
  return result.rows;
}

async function fetchLiveAnalyteCatalogRows(db: Db, analyteDisplay: string): Promise<AnalyteCatalogLiveRow[]> {
  const result = await db.execute<AnalyteCatalogLiveRow>(sql`
    SELECT a.data_type
    FROM analyte a
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

  for (const { file, table } of GOLDEN_FILES) {
    const goldenEntries =
      table === "reference_range"
        ? loadGoldenFile<ReferenceRangeGoldenEntry>(file)
        : table === "delta_check_rule"
          ? loadGoldenFile<DeltaCheckGoldenEntry>(file)
          : loadGoldenFile<AnalyteCatalogGoldenEntry>(file);
    const analyteNames = [...new Set(goldenEntries.map((e) => e.analyte))];

    const goldenKeys = new Set(
      table === "reference_range"
        ? (goldenEntries as ReferenceRangeGoldenEntry[]).map(referenceRangeEntryKey)
        : table === "delta_check_rule"
          ? (goldenEntries as DeltaCheckGoldenEntry[]).map(deltaCheckEntryKey)
          : (goldenEntries as AnalyteCatalogGoldenEntry[]).map(analyteCatalogEntryKey),
    );
    const liveKeys = new Set<string>();

    for (const name of analyteNames) {
      const [row] = await db.select({ id: analyte.id }).from(analyte).where(sql`${analyte.display} = ${name}`).limit(1);
      if (!row) {
        failures.push(`[${file}] ${name}: no analyte row found in the catalog at all — run \`pnpm db:reset\` first`);
        continue;
      }
      if (table === "reference_range") {
        const liveRows = await fetchLiveReferenceRangeRows(db, name);
        for (const r of liveRows) {
          liveKeys.add(
            referenceRangeEntryKey({
              analyte: name,
              sex: r.sex,
              condition: r.condition,
              rangeType: r.range_type,
              low: r.low === null ? null : Number(r.low),
              high: r.high === null ? null : Number(r.high),
            }),
          );
        }
      } else if (table === "delta_check_rule") {
        const liveRows = await fetchLiveDeltaCheckRows(db, name);
        for (const r of liveRows) {
          liveKeys.add(deltaCheckEntryKey({ analyte: name, thresholdPercent: Number(r.threshold_percent) }));
        }
      } else {
        const liveRows = await fetchLiveAnalyteCatalogRows(db, name);
        for (const r of liveRows) {
          liveKeys.add(analyteCatalogEntryKey({ analyte: name, dataType: r.data_type }));
        }
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

  console.log("PASS: every golden dataset and its live table agree exactly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
