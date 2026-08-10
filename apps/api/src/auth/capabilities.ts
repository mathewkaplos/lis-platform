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
 *
 * `manage_specimens` (TASK-047, FEAT-013 revision §2/§10 Q2): identical
 * reasoning and grant as `manage_patients`/`manage_orders` — no dedicated
 * reception/accessioning role exists in Keycloak yet.
 *
 * `resolve_qc` (TASK-070, FEAT-020 proposal §10 Q4, ADR-0019 Decision 3):
 * granted to a new `qa` role, not `technologist`/`verifier` — resolving a QC
 * rule violation and verifying a patient result are different real-world
 * actors, matching KB-10's own persona list (`lab_director` / `qa`, distinct
 * from `technologist`/`verifier`). Unlike `manage_patients`/`manage_orders`/
 * `manage_specimens` above, this is a genuine new role, not a grant onto an
 * existing one — see `infra/keycloak/lis-realm.json`.
 *
 * `gateway_ingest` (FEAT-026 proposal, ADR-0026): granted only to
 * `gateway-ingest`, a machine role held exclusively by the edge gateway's
 * Keycloak service-account client — never assigned to a human user. Kept as
 * its own capability/role pair, not folded into an existing human role, so
 * the ingestion endpoint's authorization is legible on its own (a human
 * role gaining this capability would be a real, reviewable change, not an
 * accidental side effect of some other role's grant list changing).
 *
 * `manage_workflow` (FEAT-029 proposal §2): granted to `qa`, not
 * `technologist`/`verifier` — authoring/publishing a workflow definition
 * changes what automated behavior applies to every future result, a
 * lab-oversight action matching `resolve_qc`'s own persona (`qa` /
 * lab-manager), not day-to-day result entry/verification.
 *
 * `manage_report_templates` (FEAT-032 proposal §10 identical reasoning to
 * `manage_workflow`): granted to `qa`, not `technologist`/`verifier` —
 * authoring/publishing a report template changes what layout every future
 * report for that test renders as, the same lab-oversight class of action
 * as `manage_workflow`, not day-to-day result entry/verification.
 *
 * `manage_catalog` (FEAT-035 proposal §2, identical reasoning to
 * `manage_workflow`/`manage_report_templates`): granted to `qa`, not
 * `technologist`/`verifier` — creating a test or a reference range changes
 * what every future order/result validates and flags against, the same
 * lab-oversight class of action as the other two, not day-to-day result
 * entry/verification. Covers both `test_definition`/`test_analyte` and
 * `reference_range` creation (proposal §5: one capability, not split
 * per-resource, no stated need yet to differentiate).
 *
 * `view_operational_reports` (FEAT-034 proposal §10 Q1): granted to `qa`,
 * not `technologist`/`verifier` — TAT/workload/rejection-rate reports are
 * "give lab management visibility" data (the issue's own purpose line);
 * "workload by bench/analyst" specifically is real, individual-staff-
 * performance-shaped data, a different sensitivity class from a purely
 * clinical read (contrast `GET .../prior`, ungated), matching `resolve_qc`'s
 * own persona (`qa`/lab-manager).
 *
 * `interop_ingest` (FEAT-036 proposal, ADR-0035): granted only to
 * `interop-ingest`, a machine role held exclusively by `apps/interop`'s own
 * Keycloak service-account client — never assigned to a human user. Same
 * reasoning as `gateway_ingest` (`domain/analyzer-integration` Skill entry
 * #4): a new machine caller gets its own client/role/capability, never
 * folded into an existing one, so a human role gaining this capability (or
 * `gateway_ingest`/`interop_ingest` merging) would be a real, reviewable
 * diff, not an accidental side effect.
 *
 * `view_own_results` (FEAT-039 proposal §10 Q3): granted only to `patient`.
 * Unlike `PatientController`'s own ungated routes (FEAT-011, grandfathered,
 * `engineering/authz` entry #1), this is a brand-new route with no legacy
 * history forcing an ungated shape — KB-10's intended RBAC (this capability)
 * + ABAC (`resolveOwnPatientId`'s self-identity filter) two-layer model is
 * followed cleanly from the start.
 */
export type Capability =
  | 'enter_result'
  | 'verify'
  | 'manage_patients'
  | 'manage_orders'
  | 'manage_specimens'
  | 'resolve_qc'
  | 'gateway_ingest'
  | 'manage_workflow'
  | 'manage_report_templates'
  | 'manage_catalog'
  | 'view_operational_reports'
  | 'interop_ingest'
  | 'view_own_results';

const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  technologist: [
    'enter_result',
    'manage_patients',
    'manage_orders',
    'manage_specimens',
  ],
  verifier: [
    'enter_result',
    'verify',
    'manage_patients',
    'manage_orders',
    'manage_specimens',
  ],
  qa: [
    'resolve_qc',
    'manage_workflow',
    'manage_report_templates',
    'manage_catalog',
    'view_operational_reports',
  ],
  'gateway-ingest': ['gateway_ingest'],
  'interop-ingest': ['interop_ingest'],
  patient: ['view_own_results'],
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
