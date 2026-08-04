/**
 * KB-10 (Authorization): roles bundle capabilities. Centralised, testable
 * policy per KB-10's own design decision — the cheap version of its
 * "Policy-as-code" future item, not a competing design (ADR-0011).
 *
 * Only the roles TASK-032/TASK-039's own ACs actually need are modeled here
 * (`technologist`, `verifier`) — the rest of KB-10's role list is added
 * when a future task first needs it, same discipline TASK-028 already used
 * to defer inventing roles ahead of this feature.
 *
 * `manage_patients` (TASK-039, FEAT-011 proposal §10 Q2): granted to both
 * existing roles for now — no dedicated `registrar`/front-desk role exists
 * in Keycloak yet, and inventing one is a separate, real infra decision, not
 * this task's own scope. Narrowing this grant once a real registrar role
 * exists is a small follow-up, not a rearchitecture.
 *
 * `manage_orders` (TASK-042, FEAT-012 proposal §5): identical reasoning and
 * grant as `manage_patients` — order entry is the same front-desk-adjacent
 * action with no dedicated role yet.
 */
export type Capability =
  'enter_result' | 'verify' | 'manage_patients' | 'manage_orders';

const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  technologist: ['enter_result', 'manage_patients', 'manage_orders'],
  verifier: ['enter_result', 'verify', 'manage_patients', 'manage_orders'],
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
