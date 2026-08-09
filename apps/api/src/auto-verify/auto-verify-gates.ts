/**
 * FEAT-031 (ADR-0031). Pure deny-by-default gate check, kept separate from
 * `auto-verify-observation.command.ts`'s own DB lookups so it's
 * unit-testable without a database (same split `reflex-guardrails.ts`
 * already established for FEAT-030).
 *
 * The `when` condition on a workflow rule is never the safety boundary --
 * these four gates are re-checked here against fresh input regardless of
 * what any rule's own `when` claims (ADR-0031's whole point). `critical` is
 * checked first and independently of `notCleanNormal`, even though a
 * critical flag alone would also fail the clean-normal check, so the
 * specific violation surfaced is always the most safety-relevant one.
 */

export type AutoVerifyGateViolation =
  'critical' | 'not_clean_normal' | 'not_analyzer' | 'qc_held';

export function checkAutoVerifyGates(input: {
  flags: string[];
  source: string;
  qcHeld: boolean;
}): AutoVerifyGateViolation | null {
  if (input.flags.includes('HH') || input.flags.includes('LL')) {
    return 'critical';
  }
  if (!(input.flags.length === 1 && input.flags[0] === 'N')) {
    return 'not_clean_normal';
  }
  if (input.source !== 'analyzer') {
    return 'not_analyzer';
  }
  if (input.qcHeld) {
    return 'qc_held';
  }
  return null;
}
