# Implementation Proposal: FEAT-040 — Fine-grained ABAC / relationship authz
Status: APPROVED
ADR: none required — patient-only care_relationship (§10 Q3) is a plain additive table, not a load-bearing architectural decision on the scale of ADR-0011/0026/0027   Date: 2026-08-10   Backlog ID: FEAT-040

## 1. Goal
Enforce the one stated acceptance criterion: a principal holding the `clinician` role can only
read patients they have an established care relationship with — verified by a real isolation
test, not merely a code-review claim. Today, `PatientController.search()`/`getById()` are gated by
`JwtAuthGuard` only (no capability check at all) — *any* authenticated tenant principal, regardless
of role, currently sees every patient in the tenant. Introducing `clinician` as a real role means
that default ("authenticated in this tenant → see everything") can no longer hold for it.

## 2. Affected files
- New migration `db/migrations/00XX_care_relationship.sql` (drizzle-kit generated from a schema
  change) — new `care_relationship` table + its `tenant_isolation` RLS policy.
- `packages/db/src/schema/care-relationship.ts` (or added to an existing schema file) — the new
  table definition.
- `infra/keycloak/lis-realm.json` — new `clinician` realm role (KB-10 already names it; not yet
  provisioned anywhere in this repo).
- `apps/api/src/patient/patient.controller.ts` — `search()`/`getById()` branch on the caller's
  roles: a relationship-scoped query for a `clinician`-only principal, unchanged behavior for
  every other existing case (see §10 Q1/Q2).
- New `engineering/authz` Skill (`lis-engineering`) — referenced by this issue's own "Required
  Skills" but does not exist yet; authored from this task's real findings, not speculatively
  (same discipline FEAT-036 applied to `domain/hl7-v2`).

## 3. Architecture consulted
- KB-10 (Authorization) — the RBAC+ABAC hybrid model; explicitly names "clinicians see
  patients/orders they have a care relationship with" as the portal-access shape this task builds
  the enforcement mechanism for.
- **ADR-0011** — directly on point. Its own Consequences section states attribute-based scope
  "will need its own decision... whenever a task first needs it" and explicitly frames the choice
  as Keycloak-attribute (mirroring `tenant_id`) vs. Postgres (since facility/discipline-shaped
  attributes are "more naturally relational, queryable, and joinable against clinical data"). This
  task is that task — §5 below makes that call.
- Constitution Law #4 (tenant isolation is structural, RLS from the migration that creates the
  table) — applies to the new `care_relationship` table exactly as to every other tenant-scoped
  table, no exception.
- `apps/api/src/auth/capabilities.ts` — the existing static role→capability map (ADR-0011's
  "centralised, testable policy") this task extends, not replaces.

## 4. Skills loaded
- `engineering/api-design` — query/response conventions for the two modified `PatientController`
  routes.
- `engineering/database-design` — RLS policy shape for the new table (mirrors `sla_breach`'s own
  recent `tenant_isolation` policy, migration 0032).
- `engineering/authentication` — the existing JWT/role-parsing plumbing this task reads from
  (`RequestContext.roles`), not a new authentication mechanism.
- `engineering/authz` — does not exist yet (see §2); authored during this task.

## 5. Assumptions & autonomous decisions
- **`care_relationship` is a new Postgres table, not a Keycloak user attribute.** Per ADR-0011's
  own anticipated resolution: a clinician-patient relationship is inherently relational and needs
  to be joined against `patient` in ordinary SQL queries — exactly the case ADR-0011 named as the
  natural fit for Postgres over a token attribute.
- **`care_relationship.clinicianUserId` stores the raw Keycloak `sub` (text)**, not a foreign key to
  a `user` table — no `user` table exists anywhere in this codebase (confirmed: `report-assembly.ts`
  already flags this same gap for `verifierUserId`/`generatedByUserId`). Consistent with every other
  "who did this" column in this schema.
- **No HTTP endpoint to create a `care_relationship` row is built in this task.** The stated AC is
  about the *read-side isolation check*, not relationship *management*. Mirrors
  `observation.e2e-spec.ts`'s own established precedent ("no admin endpoint exists to create a
  `test_definition`/`analyte` through HTTP" — synthetic fixtures inserted directly via `@lis/db`).
  A real assignment mechanism (UI, admin endpoint, or provisioning as part of FEAT-038) is real,
  necessary follow-on work, not silently treated as solved by this task.
- **Scope limited to `PatientController` (`search`/`getById`) only** — the AC's own wording is
  "access patients," not orders or observations. Extending equivalent relationship-scoping to
  `OrderController`/`ObservationController` reads is real future work FEAT-038 (Clinician portal)
  will need, but is not decided or built speculatively here (this repo's own "don't build ahead of
  a real need" discipline — same reasoning FEAT-026 didn't build a second driver ahead of a
  confirmed instrument).

## 6. Risks
- **Dual-role semantics are undefined by KB-10.** A principal holding both `clinician` and an
  existing tenant-wide role (`technologist`/`verifier`/`qa`) has no stated precedent for which
  scope wins — flagged as §10 Q1, not assumed.
- **The pre-existing "any authenticated tenant principal sees every patient" behavior for
  `search()`/`getById()` is broader than KB-10's own target model**, but changing it for
  *non*-clinician callers is a real behavior change beyond this task's single stated AC — flagged
  as §10 Q2, not silently expanded into scope.
- **`engineering/authz` Skill doesn't exist yet** — authoring it well depends on this task's own
  real implementation findings, not a template written ahead of doing the work (same risk profile
  FEAT-036 accepted for `domain/hl7-v2`).
- A clinician with zero established relationships is a real, valid state (a newly onboarded
  clinician) — the isolation test must prove this returns an empty result set, not an error.

## 7. Acceptance criteria
(from issue #49, verbatim)
- [ ] A clinician can only access patients with an established care relationship, verified by
      isolation test

## 8. Testing plan
- e2e (real Keycloak + Postgres, matching this repo's own standard for anything auth-adjacent):
  - A new `clinician`-role realm user (Keycloak) with a real `care_relationship` row (inserted
    directly via `@lis/db`, per §5) for one patient but not another.
  - `GET /v1/patients/:id` for the related patient → 200.
  - `GET /v1/patients/:id` for an unrelated (but same-tenant, real) patient → 404 — matching
    `engineering/api-design` entry #7's existing "cross-tenant → 404, never 403" convention,
    applied here to "no relationship" too (never confirm the row's existence to a caller who can't
    see it).
  - `GET /v1/patients` (search) for a clinician with zero relationships → empty result, not an
    error.
  - Regression: an existing `technologist`/`verifier`/`qa` token's behavior on both routes is
    unchanged (still sees every tenant patient) — proves this task didn't narrow existing roles'
    access as a side effect.
- RLS isolation test for the new `care_relationship` table (this repo's standard for every new
  tenant-scoped table).

## 9. Rollback plan
Entirely additive: a new table, a new Keycloak role, and a role-conditional branch inside two
existing routes' query logic (not a replacement of their existing query). Rollback is reverting
the branch to its prior unconditional query and leaving the unused table/role in place — no
destructive migration `down` needed.

## 10. Questions requiring human approval — RESOLVED 2026-08-10

1. **Dual-role principal (`clinician` + an existing tenant-wide role): full visibility or
   relationship-scoped?** **RESOLVED: full visibility wins.** Any tenant-wide role present
   (`technologist`/`verifier`/`qa`) grants full visibility, same as today — KB-10 frames
   relationship-scoping as the *portal* access shape for an external clinician, not a restriction
   on internal staff who also happen to hold a clinical credential. `clinician`-only (no other
   role) is the only case that gets relationship-scoped.

2. **Should the pre-existing "zero roles / any other unlisted role → full tenant visibility"
   behavior on `search()`/`getById()` change as part of this task?** **RESOLVED: no, leave
   unchanged.** Only the `clinician`-specific branch is added. Retrofitting a capability gate onto
   both routes for every other role is a materially bigger, separate authorization-policy decision
   this task's single AC doesn't ask for.

3. **Should `care_relationship` stay patient-only, or anticipate order/observation-level
   relationships now for FEAT-038's sake?** **RESOLVED: patient-only for now** — a plain
   `patientId` FK, matching this task's own AC wording exactly and this repo's consistent
   "don't build ahead of a confirmed need" discipline. Revisit when FEAT-038 actually specifies
   what else a clinician needs to see.

4. **No relationship-assignment mechanism (UI or API) ships in this task — acceptable?**
   **RESOLVED: yes, DB-insert only for now.** This task proves the enforcement mechanism works
   given a manually-inserted relationship row (same precedent as `observation.e2e-spec.ts`'s own
   synthetic fixtures). A real assignment mechanism is follow-on work for FEAT-038 or a dedicated
   admin task, not this one.
