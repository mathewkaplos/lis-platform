/**
 * KB-10 (Authorization): roles bundle capabilities. Centralised, testable
 * policy per KB-10's own design decision — the cheap version of its
 * "Policy-as-code" future item, not a competing design (ADR-0011).
 *
 * Only the two roles TASK-032's AC actually needs are modeled here
 * (`technologist`, `verifier`) — the rest of KB-10's role list is added
 * when a future task first needs it, same discipline TASK-028 already used
 * to defer inventing roles ahead of this feature.
 */
export type Capability = 'enter_result' | 'verify';

const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  technologist: ['enter_result'],
  verifier: ['enter_result', 'verify'],
};

/**
 * Resolves the single role — of however many the caller holds — that grants
 * the requested capability. Iterates `ROLE_CAPABILITIES`' own key order, so
 * the result is deterministic (not arbitrary) when a caller holds multiple
 * capability-granting roles: two audit rows for the same logical action must
 * never disagree on which role authorized it (ADR-0011 §6).
 *
 * Returns `undefined` — deny — for an empty `roles` array or a set of roles
 * with no matching grant. This is not a special case: it falls out of the
 * same lookup as every other denial, which is exactly what ADR-0011's
 * fail-closed acceptance criterion requires proof of (every token issued
 * today has an empty `roles` array, since no realm role existed before this
 * task).
 */
export function resolveGrantingRole(
  roles: readonly string[],
  capability: Capability,
): string | undefined {
  return Object.keys(ROLE_CAPABILITIES).find(
    (role) =>
      roles.includes(role) && ROLE_CAPABILITIES[role].includes(capability),
  );
}
