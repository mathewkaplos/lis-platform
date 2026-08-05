import type { NoRangeResult, ResolvedRange } from "./reference-range";

/**
 * KB-14/KB-15 severity flag, one of `N | L | LL | H | HH` (TASK-050
 * proposal §5) -- a single-element array, never `L` and `LL` together for
 * the same value; `observation.flags` is `text[]` so a future task can
 * still append `A`/`D`/`R` alongside this severity flag.
 *
 * `critical`'s own `low`/`high` fields are inverted relative to `normal`'s
 * (db/seed/chemistry-catalog.sql's own header comment, TASK-050 proposal
 * §1): `critical.low` is the critical-HIGH threshold (value >= it -> HH),
 * `critical.high` is the critical-LOW threshold (value <= it -> LL). Named
 * explicitly below so the inversion can't be missed by skimming variable
 * names.
 *
 * No `normal` match (`no_range`) returns `[]` rather than a fabricated
 * `'N'` (KB-15's own "no_range... never silently treated as normal" rule)
 * -- a critical match alone can still produce `LL`/`HH` even with no
 * matching `normal` range, matching real lab practice: critical alerting
 * isn't gated on a normal range existing.
 *
 * Boundary inclusivity (TASK-050 proposal §10 Q1, resolved 2026-08-05):
 * inclusive both ways -- a value exactly at a reference-range bound is
 * `N`, exactly at a critical threshold is already `LL`/`HH`.
 */
export function computeFlags(value: number, normal: ResolvedRange | NoRangeResult, critical: ResolvedRange | NoRangeResult): string[] {
  if (critical.matched) {
    const criticalHighThreshold = critical.low === null ? null : Number(critical.low);
    const criticalLowThreshold = critical.high === null ? null : Number(critical.high);

    if (criticalLowThreshold !== null && value <= criticalLowThreshold) {
      return ["LL"];
    }
    if (criticalHighThreshold !== null && value >= criticalHighThreshold) {
      return ["HH"];
    }
  }

  if (!normal.matched) {
    return [];
  }

  const low = normal.low === null ? null : Number(normal.low);
  const high = normal.high === null ? null : Number(normal.high);

  if (low !== null && value < low) {
    return ["L"];
  }
  if (high !== null && value > high) {
    return ["H"];
  }
  return ["N"];
}
