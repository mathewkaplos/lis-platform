/**
 * FEAT-059 (ADR-0051). Pure gate check, kept separate from StepUpGuard's own
 * request/exception plumbing so it's unit-testable without a Nest execution
 * context — same "pure gate, DB-free" split `auto-verify-gates.ts` already
 * established for FEAT-031.
 *
 * `maxAgeSeconds` is 300 (STEP_UP_MAX_AGE_SECONDS, step-up.guard.ts),
 * anchored to the realm's own `accessTokenLifespan` rather than an arbitrary
 * separate number (proposal §5/§10 Q4).
 */
export function checkStepUpFreshness(
  authTime: number,
  now: number,
  maxAgeSeconds: number,
): boolean {
  return now - authTime <= maxAgeSeconds;
}
