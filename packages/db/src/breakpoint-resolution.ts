import { and, eq, isNull, lte, or, gt } from "drizzle-orm";
import type { createDb } from "./client";
import { breakpoint } from "./schema/microbiology-catalog";
import { breakpointTable } from "./schema/microbiology-catalog";

type Db = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export type BreakpointRow = typeof breakpoint.$inferSelect;

// Mirrors @lis/domain's own `susceptibilityInterpretationSchema` value set
// exactly -- kept as a plain local type, not imported, since no existing
// @lis/db file depends on @lis/domain (a new package-dependency direction
// this feature doesn't need to introduce for one 3-value union).
export type SusceptibilityInterpretation = "S" | "I" | "R";

/**
 * FEAT-051 (docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md
 * §5/§8). Standard EUCAST interpretation logic, adapted from
 * `reference-range.ts`'s own pure-resolver shape but structurally simpler
 * (proposal §5: no multi-dimensional specificity scoring -- breakpoint
 * resolution keys on exact organism+antimicrobial+method, not wildcarded
 * patient dimensions).
 */
export function interpretMic(
  micValue: number,
  susceptibleMax: number,
  resistantMin: number,
): SusceptibilityInterpretation {
  if (micValue <= susceptibleMax) return "S";
  if (micValue > resistantMin) return "R";
  return "I";
}

export interface ResolveBreakpointParams {
  organismId: string;
  antimicrobialId: string;
  method: string; // 'MIC' -- v1 scope, see schema file's own header comment
  micValue: number;
  /** Defaults to the current time. Pass the Observation's own produced-at
   * time so a resolved interpretation for a past result stays reproducible
   * (KB-15's snapshot philosophy, same as `resolveObservationRange`'s own
   * `at` parameter). */
  at?: Date;
}

export interface ResolvedBreakpoint {
  matched: true;
  breakpointId: string;
  breakpointTableId: string;
  interpretation: SusceptibilityInterpretation;
}

export interface NoBreakpointResult {
  matched: false;
}

/**
 * Fetches the applicable `breakpoint` row (joined to its own
 * `breakpoint_table` for effective-dating) and resolves a real MIC value
 * against it. Never fabricates a match when none exists -- an explicit
 * `{matched: false}`, mirroring `resolveReferenceRange`'s own "no fabricated
 * normal" discipline. If more than one breakpoint_table is ever effective
 * for the same organism+antimicrobial+method at the same instant (not
 * possible with this feature's own v1 seed data, which ships exactly one
 * table), the most recently effective one wins -- the same tie-break
 * precedent `reference-range.ts`'s own `tieBreak()` already established for
 * priority ties, adapted to this simpler single-dimension case.
 */
export async function resolveSusceptibility(
  db: DbOrTx,
  params: ResolveBreakpointParams,
): Promise<ResolvedBreakpoint | NoBreakpointResult> {
  const at = params.at ?? new Date();

  const rows = await db
    .select({
      id: breakpoint.id,
      breakpointTableId: breakpoint.breakpointTableId,
      susceptibleMax: breakpoint.susceptibleMax,
      resistantMin: breakpoint.resistantMin,
      effectiveFrom: breakpointTable.effectiveFrom,
    })
    .from(breakpoint)
    .innerJoin(
      breakpointTable,
      eq(breakpoint.breakpointTableId, breakpointTable.id),
    )
    .where(
      and(
        eq(breakpoint.organismId, params.organismId),
        eq(breakpoint.antimicrobialId, params.antimicrobialId),
        eq(breakpoint.method, params.method),
        lte(breakpointTable.effectiveFrom, at),
        or(isNull(breakpointTable.effectiveTo), gt(breakpointTable.effectiveTo, at)),
      ),
    );

  if (rows.length === 0) {
    return { matched: false };
  }

  const best = rows.reduce((a, b) => (a.effectiveFrom > b.effectiveFrom ? a : b));

  return {
    matched: true,
    breakpointId: best.id,
    breakpointTableId: best.breakpointTableId,
    interpretation: interpretMic(
      params.micValue,
      Number(best.susceptibleMax),
      Number(best.resistantMin),
    ),
  };
}
