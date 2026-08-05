import { eq } from "drizzle-orm";
import type { createDb } from "./client";
import { referenceRange } from "./schema/reference-range";

type Db = ReturnType<typeof createDb>;
// Same DbOrTx convention as accession.ts/audit.ts.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export type ReferenceRangeRow = typeof referenceRange.$inferSelect;

/**
 * KB-15's multi-dimensional resolution context for a single Observation.
 * `sex`/`ageDays` come from the patient (FEAT-014 proposal §1 findings #4,
 * §5): `sex: 'U'` and `ageDays: null` are real, explicit "unknown" states
 * (per patient.ts, KB-02), not absent data to be treated as wildcards --
 * they must only match `reference_range` rows that are themselves wildcards
 * on that dimension (see `compatible()` below), never a specific-sex or
 * age-bounded row. `condition`/`method`/`specimenType`/`population` are
 * optional because most callers won't know or need them yet -- absence
 * behaves the same as an explicit `null` (wildcard-row-only match).
 */
export interface ResolutionContext {
  unitId: string;
  sex: "M" | "F" | "U";
  ageDays: number | null;
  condition?: string | null;
  method?: string | null;
  specimenType?: string | null;
  population?: string | null;
  at: Date;
}

export interface ResolvedRange {
  matched: true;
  // Usually one row; more than one only when KB-15's "either bound
  // optional -> one-sided" allowance produced two equally-specific,
  // complementary one-sided rows for the same dimensional key (see
  // mergeTiedRows() below) -- e.g. this repo's own
  // db/golden/chemistry-ranges-criticals.json models each analyte's
  // critical threshold as a separate critical-low row (high only) and
  // critical-high row (low only), not one two-sided row.
  rangeRowIds: string[];
  low: string | null;
  high: string | null;
  textualRange: string | null;
  condition: string | null;
  source: string | null;
  interpretationWhenIn: string | null;
}

export interface NoRangeResult {
  matched: false;
}

/**
 * FEAT-014 proposal §10 Q1 (resolved 2026-08-05): a weighted sum where
 * `method` alone outranks any combination of the lower-tier dimensions,
 * matching KB-15's qualitative example ("method-specific > sex+age > age
 * only > default") exactly. Only non-wildcard (non-null) dimensions on the
 * candidate row score -- a row that leaves a dimension unspecified is a
 * wildcard on it, not a "worse match."
 */
const SPECIFICITY_WEIGHTS = {
  method: 100,
  sex: 10,
  age: 10,
  condition: 5,
  specimenType: 3,
  population: 1,
} as const;

function specificityScore(row: ReferenceRangeRow): number {
  let score = 0;
  if (row.method !== null) score += SPECIFICITY_WEIGHTS.method;
  if (row.sex !== null) score += SPECIFICITY_WEIGHTS.sex;
  if (row.ageLowDays !== null || row.ageHighDays !== null) score += SPECIFICITY_WEIGHTS.age;
  if (row.condition !== null) score += SPECIFICITY_WEIGHTS.condition;
  if (row.specimenType !== null) score += SPECIFICITY_WEIGHTS.specimenType;
  if (row.population !== null) score += SPECIFICITY_WEIGHTS.population;
  return score;
}

/**
 * A row's own null dimension is a wildcard (always compatible); a
 * non-null dimension must equal the context's value exactly. `ctx.sex`
 * being `'U'` (unknown, per patient.ts) or `ctx.ageDays` being `null`
 * (unknown birthDate) never match a row that specifies that dimension --
 * only a wildcard row can apply (FEAT-014 proposal §1 finding #4). Unit
 * mismatch and effective-window exclusion are both real exclusion
 * reasons too (proposal §5/§8), not just the dimensional ones KB-15
 * itself describes.
 */
function compatible(row: ReferenceRangeRow, ctx: ResolutionContext): boolean {
  if (row.unitId !== ctx.unitId) return false;
  if (row.effectiveFrom > ctx.at) return false;
  if (row.effectiveTo !== null && row.effectiveTo <= ctx.at) return false;

  if (row.sex !== null && row.sex !== ctx.sex) return false;

  if (row.ageLowDays !== null || row.ageHighDays !== null) {
    if (ctx.ageDays === null) return false;
    if (row.ageLowDays !== null && ctx.ageDays < row.ageLowDays) return false;
    if (row.ageHighDays !== null && ctx.ageDays > row.ageHighDays) return false;
  }

  if (row.condition !== null && row.condition !== (ctx.condition ?? null)) return false;
  if (row.method !== null && row.method !== (ctx.method ?? null)) return false;
  if (row.specimenType !== null && row.specimenType !== (ctx.specimenType ?? null)) return false;
  if (row.population !== null && row.population !== (ctx.population ?? null)) return false;

  return true;
}

/**
 * Real finding during this task's own implementation (not anticipated when
 * the proposal was drafted): `db/golden/chemistry-ranges-criticals.json`
 * models each analyte's critical threshold as *two* rows with identical
 * dimensional keys -- a critical-low row (`low: null, high: <threshold>`)
 * and a critical-high row (`low: <threshold>, high: null`) -- not one
 * two-sided row. KB-15's own schema comment explicitly allows this
 * ("low?, high? # interval, either bound optional -> one-sided"), so this
 * is a real, KB-sanctioned shape to handle, not a data error to work
 * around. When multiple compatible rows tie for the top specificity score,
 * merge their non-null `low`/`high` instead of arbitrarily picking one --
 * a genuine conflict (two tied rows disagreeing on the *same* non-null
 * bound) is a real data-quality problem, so it falls back to the
 * priority/effectiveFrom tie-break instead of guessing.
 */
function mergeTiedRows(topRows: ReferenceRangeRow[]): ResolvedRange {
  const lows = [...new Set(topRows.map((r) => r.low).filter((v): v is string => v !== null))];
  const highs = [...new Set(topRows.map((r) => r.high).filter((v): v is string => v !== null))];

  if (lows.length <= 1 && highs.length <= 1) {
    const base = topRows[0];
    return {
      matched: true,
      rangeRowIds: topRows.map((r) => r.id),
      low: lows[0] ?? null,
      high: highs[0] ?? null,
      textualRange: base.textualRange,
      condition: base.condition,
      source: [...new Set(topRows.map((r) => r.source).filter((v): v is string => v !== null))].join("; ") || null,
      interpretationWhenIn: base.interpretationWhenIn,
    };
  }

  // Real conflict (not this repo's current data, but not impossible): fall
  // back to the standard tie-break instead of merging contradictory bounds.
  const best = tieBreak(topRows);
  return {
    matched: true,
    rangeRowIds: [best.id],
    low: best.low,
    high: best.high,
    textualRange: best.textualRange,
    condition: best.condition,
    source: best.source,
    interpretationWhenIn: best.interpretationWhenIn,
  };
}

function tieBreak(rows: ReferenceRangeRow[]): ReferenceRangeRow {
  // proposal §10 Q1: priority (descending), then most recent effectiveFrom.
  // KB-15 also names "tenant-local over shipped-default" between those two
  // -- elided, not silently dropped: no shipped-vs-tenant-local distinction
  // exists anywhere in this repo's data model yet (every reference_range
  // row is already tenant-scoped with no "default pack" concept).
  return rows.reduce((a, b) => {
    if (a.priority !== b.priority) return a.priority > b.priority ? a : b;
    return a.effectiveFrom > b.effectiveFrom ? a : b;
  });
}

/**
 * KB-15's resolution algorithm, pure (no DB access) so it's directly unit-
 * testable. `candidates` must already be filtered to a single `rangeType`
 * by the caller (resolveObservationRange calls this once for `'normal'`
 * and once for `'critical'` -- FEAT-014 proposal §1 finding #3: criticals
 * are separate rows, not columns, and resolve independently).
 *
 * Never returns a fabricated "normal" when nothing matches -- an explicit
 * `{ matched: false }` (KB-15's `no_range`), so a caller can't silently
 * treat "nothing resolved" as "in range."
 */
export function resolveReferenceRange(candidates: ReferenceRangeRow[], ctx: ResolutionContext): ResolvedRange | NoRangeResult {
  const compatibleRows = candidates.filter((row) => compatible(row, ctx));
  if (compatibleRows.length === 0) {
    return { matched: false };
  }

  const maxScore = Math.max(...compatibleRows.map(specificityScore));
  const topRows = compatibleRows.filter((row) => specificityScore(row) === maxScore);

  return mergeTiedRows(topRows);
}

function ageInDays(birthDate: Date, at: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((at.getTime() - birthDate.getTime()) / msPerDay);
}

export interface ObservationRangeParams {
  analyteId: string;
  unitId: string;
  patientSex: "M" | "F" | "U";
  patientBirthDate: Date | null;
  condition?: string | null;
  method?: string | null;
  specimenType?: string | null;
  population?: string | null;
  /** Defaults to the current time. Pass the Observation's own produced-at
   *  time so a range resolved for a past result stays reproducible
   *  (KB-15's snapshot philosophy applied to the age input, not just the
   *  range output -- proposal §5). */
  at?: Date;
}

export interface ObservationRangeResult {
  normal: ResolvedRange | NoRangeResult;
  critical: ResolvedRange | NoRangeResult;
}

/**
 * Fetches this analyte's `reference_range` candidates and resolves both
 * the `normal` and `critical` rangeType independently (proposal §1
 * finding #3). Relies on the caller having already bound the tenant
 * session (`SET LOCAL app.tenant_id`, per every other tenant-scoped
 * query in this repo) -- `reference_range`'s own `tenant_isolation` RLS
 * policy does the actual filtering, this function issues no explicit
 * `tenant_id` predicate, matching every other tenant-scoped query
 * elsewhere in `packages/db`/`apps/api`.
 */
export async function resolveObservationRange(db: DbOrTx, params: ObservationRangeParams): Promise<ObservationRangeResult> {
  const at = params.at ?? new Date();
  const ageDays = params.patientBirthDate === null ? null : ageInDays(params.patientBirthDate, at);

  const ctx: ResolutionContext = {
    unitId: params.unitId,
    sex: params.patientSex,
    ageDays,
    condition: params.condition ?? null,
    method: params.method ?? null,
    specimenType: params.specimenType ?? null,
    population: params.population ?? null,
    at,
  };

  const rows = await db.select().from(referenceRange).where(eq(referenceRange.analyteId, params.analyteId));

  const normalCandidates = rows.filter((row) => row.rangeType === "normal");
  const criticalCandidates = rows.filter((row) => row.rangeType === "critical");

  return {
    normal: resolveReferenceRange(normalCandidates, ctx),
    critical: resolveReferenceRange(criticalCandidates, ctx),
  };
}
