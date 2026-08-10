# Implementation Proposal: FEAT-039 — Patient portal
Status: IMPLEMENTED (merged PR #466, 39a3ee6582c6024f94ba766090de8d9164eb0c45, closed issue #48)
ADR: none required — result-release policy is a small additive config table, not a load-bearing architectural decision on the scale of ADR-0011/0026/0027   Date: 2026-08-10   Backlog ID: FEAT-039

## 1. Goal
Satisfy the one stated acceptance criterion: a patient can view their own verified results and
trends, gated by the configured release policy. KB-32's full target (a separate Next.js app, AI
plain-language explanations, appointment info, notifications, PDF downloads) is the destination;
this task builds the first real slice, composed inside the existing `apps/web` app using existing
`packages/ui` primitives only — the issue's own "Google Stitch prompts required: Not applicable"
confirms no new design is expected.

## 2. Affected files
- New migration: `patient_portal_account` (links a Keycloak `sub` to exactly one `patient` row) and
  `result_release_policy` (one row per tenant: `mode`, `delay_hours`) — both tenant-scoped, RLS from
  creation.
- `infra/keycloak/lis-realm.json` — new `patient` realm role; a new seeded test user + portal-account
  fixture for e2e.
- New `apps/api/src/portal/` module: `patient-self-scope.ts` (identity resolution, mirrors
  `clinician-scope.ts`), `release-policy.ts` (the gate), `portal-results.service.ts` (reuses
  `assembleCumulativeReport`'s per-analyte query shape), `portal.controller.ts`, `portal.module.ts`.
- New `apps/api/src/auth/capabilities.ts` entry: `view_own_results`, granted only to `patient`.
- New `apps/web/app/(app)/portal/results/page.tsx` + a hand-rolled inline-SVG trend chart component,
  mirroring `levey-jennings-chart.tsx`'s own existing structural pattern (this repo's established
  precedent: no charting library dependency, `packages/ui`'s `DataTable`/`Badge`/`StatCard` plus a
  local SVG component).

## 3. Architecture consulted
- KB-32 (Patient Portal) — "own-data-only... enforced server-side," "structured results + per-analyte
  trends," "configurable, jurisdiction-aware release rules."
- KB-10 (Authorization) — this is the first new route in this repo that fits KB-10's *intended*
  two-layer model cleanly from the start: a real capability (`view_own_results`, RBAC layer) *and*
  a self-identity row-level filter (ABAC layer) together, unlike FEAT-040's `PatientController`
  routes, which had no capability gate to begin with (grandfathered from FEAT-011, not a new route).
- ADR-0011 — same "attribute lives in Postgres" precedent FEAT-040 already applied; extended here to
  a second Postgres-resident attribute table (`patient_portal_account`), plus a small,
  genuinely-new-shape config table (`result_release_policy`) this repo has no prior precedent for.
- FEAT-033 (`cumulative-report-assembly.ts`) — the exact "verified-only, snapshot-value,
  per-patient/analyte, chronological" query this task reuses rather than re-deriving.
- `apps/web/app/(app)/control-lots/[id]/chart/levey-jennings-chart.tsx` — this repo's own real
  precedent for a hand-rolled inline-SVG chart with no charting-library dependency.

## 4. Skills loaded
- `engineering/authz` (FEAT-040) — the data-scope-vs-capability distinction this task's identity
  resolution directly reuses, extended with a real capability gate this time (§3).
- `engineering/api-design`, `engineering/database-design`.
- `domain/patient-identity` — exists; consulted for `patient` table conventions.

## 5. Assumptions & autonomous decisions
- **`patient_portal_account` is 1:1** (one Keycloak `sub` ↔ exactly one `patient` row) — proxy/
  guardian access (many patients per portal account, or many accounts per patient) is explicitly a
  KB-32 "Future consideration," not built speculatively here.
- **No self-service enrollment/linking endpoint ships in this task.** A `patient_portal_account` row
  is inserted directly via `@lis/db` in tests and would need its own real enrollment flow (identity
  proofing, KB-32's own stated open question) before production use — same "prove the mechanism,
  defer real provisioning" precedent FEAT-040 already established for `care_relationship`.
- **The existing `GET /v1/patients/:patientId/cumulative-report/:analyteId` (PDF) route is
  untouched.** It's a staff-facing route with no ownership scoping by design (any tenant staff
  generates a report for any tenant patient) — this task builds new, separately-scoped JSON
  endpoints for self-access rather than retrofitting restrictions onto an existing route serving a
  different caller population.
- **UI lives inside the existing `apps/web` app** (`app/(app)/portal/results`), not a new
  application — matches the issue's own "no new UI... existing `packages/ui` primitives" framing,
  deferring KB-32's "separate app" target until a real reason to split exists.

## 6. Risks
- **Result-release policy has no existing precedent in this codebase at all** — flagged as §10 Q1,
  the one genuinely new mechanism this task must design from scratch, not extend from a prior
  feature.
- A patient with zero eligible results (newly enrolled, or every result still inside a delay-policy
  hold window) is a real, valid state — the endpoint must return an empty list, not an error.
- `patient_portal_account`/`result_release_policy` are two new tenant-scoped tables — both need a
  real fixture in `rls-isolation-check.ts`'s `insertFixtures()` (`engineering/authz` entry #6's own
  rule, from FEAT-040), not just RLS-enabled-by-migration.

## 7. Acceptance criteria
(from issue #48, verbatim)
- [ ] A patient can view their own verified results and trends, gated by the configured release
      policy

## 8. Testing plan
- e2e (real Keycloak + Postgres): a new `patient`-role test user with a real `patient_portal_account`
  row proves: own eligible results/trends visible; another (real, same-tenant) patient's results
  return nothing/404, never leaked; a result inside an active delay-policy hold is excluded until
  the hold expires; an immediate-policy tenant shows a result as soon as it's verified; zero eligible
  results returns an empty list, not an error.
- RLS isolation test for both new tables (`rls-isolation-check.ts` fixtures).
- Manual: exercise the new portal page as a real seeded `patient` user against the locally running
  dev server (this repo's own "boot the real compiled server" discipline, `engineering/api-design`
  entry #10).

## 9. Rollback plan
Entirely additive: two new tables, a new role/capability, a new module, and a new UI route section
— no changes to any existing table, route, or read path. Rollback is removing the new module from
`AppModule` and the new route segment from `apps/web`.

## 10. Questions requiring human approval — RESOLVED 2026-08-10

1. **Result-release policy mechanism — how "configured" should it be for v1?** **RESOLVED: minimal
   real per-tenant config.** A `result_release_policy` row per tenant (`mode: 'immediate' |
   'delayed'`, `delay_hours`), defaulting to `immediate`. No admin UI/endpoint to change it in v1 —
   direct DB update only, same precedent as `care_relationship`'s own no-assignment-endpoint
   decision.

2. **Trend visualization approach.** **RESOLVED: hand-rolled inline SVG**, matching
   `levey-jennings-chart.tsx`'s own existing precedent — no new charting-library dependency.

3. **Capability gate for the new portal route.** **RESOLVED: yes**, add `view_own_results` — a
   brand-new route follows KB-10's intended RBAC+ABAC two-layer model cleanly from the start.
