/**
 * TASK-067 (FEAT-019, ADR-0018): pure-function Westgard multirule evaluator.
 * No DB access (like `calculated-fields.ts`'s own shape) so it is directly
 * unit-testable and importable from `apps/api` without a Postgres
 * connection. Implements exactly the six rules ADR-0018 names as this
 * repo's fixed default set — not a configurable rule-pack (KB-27 names that
 * as a real future need, deliberately deferred, see the ADR's own
 * Alternatives Rejected).
 *
 * All comparisons are strictly `>` against the SD boundary, never `>=` —
 * Westgard's own convention (a point at exactly 2 SD is in control, not a
 * 1-2s trigger).
 */

export type WestgardRuleCode = "1_2s" | "1_3s" | "2_2s" | "r_4s" | "4_1s" | "10x";
export type WestgardSeverity = "warning" | "rejection";

export interface QcPoint {
  value: number;
  producedAt: Date;
}

export interface QcRuleViolationCandidate {
  ruleCode: WestgardRuleCode;
  severity: WestgardSeverity;
}

export interface EvaluateWestgardRulesInput {
  /**
   * This control lot's own points, ordered oldest -> newest, with the new
   * point (the one just recorded) as the last entry. Only the newest point
   * is evaluated as "the violation"; earlier points provide the trailing
   * context 2-2s/4-1s/10x need.
   */
  history: readonly QcPoint[];
  targetMean: number;
  targetSd: number;
  /**
   * The nearest different-level control result's own z-score (computed by
   * the caller against THAT lot's own mean/SD, per ADR-0018 §Decision 3),
   * within the 24-hour pairing window — or `null` if no such sibling result
   * exists. R-4s is simply not evaluated when `null`, per the ADR's own
   * "insufficient paired data, not a violation" rule.
   */
  siblingLevelZScore: number | null;
}

const REJECTION_RULES: readonly WestgardRuleCode[] = ["1_3s", "2_2s", "r_4s", "4_1s", "10x"];

function zScore(value: number, targetMean: number, targetSd: number): number {
  return (value - targetMean) / targetSd;
}

function sameSign(a: number, b: number): boolean {
  return (a > 0 && b > 0) || (a < 0 && b < 0);
}

/**
 * Evaluates the fixed Westgard multirule set against the newest point in
 * `history`. Returns the fired rejection-rule candidates if any fired;
 * otherwise returns a single `1_2s` warning candidate if that alone fired;
 * otherwise returns an empty array. 1-2s is never returned alongside a
 * confirming rejection rule (ADR-0018 §Decision 4) — it is a trigger for
 * inspecting the rejection rules, not itself persisted when one of them
 * already explains the same point.
 */
export function evaluateWestgardRules(
  input: EvaluateWestgardRulesInput,
): QcRuleViolationCandidate[] {
  const { history, targetMean, targetSd, siblingLevelZScore } = input;
  if (history.length === 0) {
    return [];
  }

  const zScores = history.map((point) => zScore(point.value, targetMean, targetSd));
  const zLast = zScores[zScores.length - 1];

  const fired = new Set<WestgardRuleCode>();

  // 1-2s: the warning-trigger rule.
  if (Math.abs(zLast) > 2) {
    fired.add("1_2s");
  }

  // 1-3s: a single point beyond 3 SD.
  if (Math.abs(zLast) > 3) {
    fired.add("1_3s");
  }

  // 2-2s: the two most recent points both beyond 2 SD on the same side.
  if (zScores.length >= 2) {
    const zPrev = zScores[zScores.length - 2];
    if (Math.abs(zLast) > 2 && Math.abs(zPrev) > 2 && sameSign(zLast, zPrev)) {
      fired.add("2_2s");
    }
  }

  // R-4s: the range between this point and the nearest different-level
  // sibling exceeds 4 SD. Not evaluated when no sibling exists in-window.
  if (siblingLevelZScore !== null && Math.abs(zLast - siblingLevelZScore) > 4) {
    fired.add("r_4s");
  }

  // 4-1s: the four most recent points all beyond 1 SD on the same side.
  if (zScores.length >= 4) {
    const last4 = zScores.slice(-4);
    const allBeyond1Sd = last4.every((z) => Math.abs(z) > 1);
    const allSameSign = last4.every((z) => sameSign(z, last4[0]));
    if (allBeyond1Sd && allSameSign) {
      fired.add("4_1s");
    }
  }

  // 10x: the ten most recent points all on the same side of the mean,
  // regardless of magnitude.
  if (zScores.length >= 10) {
    const last10 = zScores.slice(-10);
    const allSameSign = last10.every((z) => sameSign(z, last10[0]));
    if (allSameSign) {
      fired.add("10x");
    }
  }

  const firedRejections = REJECTION_RULES.filter((rule) => fired.has(rule));
  if (firedRejections.length > 0) {
    return firedRejections.map((ruleCode) => ({ ruleCode, severity: "rejection" as const }));
  }

  if (fired.has("1_2s")) {
    return [{ ruleCode: "1_2s", severity: "warning" }];
  }

  return [];
}
