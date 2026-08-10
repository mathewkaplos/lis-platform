# Implementation Proposal: FEAT-038 — Clinician portal
Status: IMPLEMENTED (merged PR #468, 983b26d3946baba46774b1b5dee97653c26c87bf, closed issue #47)
ADR: none required — every mechanism this task needs (care-relationship scoping, the "one write path"
service-extraction pattern, RBAC+ABAC two-layer capability design) already has a precedent ADR from
FEAT-040/036/027; this task applies them, it doesn't add a new load-bearing architectural choice   Date: 2026-08-10   Backlog ID: FEAT-038

## 1. Goal
Satisfy the one stated acceptance criterion: a clinician can place an order, view a result, and
acknowledge a critical for one of *their own* patients — without any lab-staff involvement in that
loop. KB-33's full target (panel presets, manual reflex selection, secure messaging, SMART-on-FHIR
embedding) is the destination; this task builds the first real slice, reusing every write/read path
FEAT-036/039/040 already established rather than re-deriving them, and adds exactly one new
mechanism this repo has no precedent for: a way for a clinician to actually *acquire* a care
relationship to a patient at all (today, per FEAT-040's own proposal, `care_relationship` rows only
exist via direct DB insert — undemoable on staging without SQL).

## 2. Affected files
- **New `apps/api/src/clinician/` module**: `clinician.controller.ts` (`POST /v1/clinician/orders`,
  `GET /v1/clinician/patients/:patientId/results`,
  `POST /v1/clinician/critical-notifications/:id/acknowledge`), `clinician.module.ts`. All three
  routes resolve own-patient scope via `relatedPatientIds()` (`clinician-scope.ts`, FEAT-040,
  unchanged) and 404 (never 403) on a patient outside that set, per `engineering/authz` entry #4.
- **`apps/api/src/patient/patient.controller.ts`**: new staff-facing
  `POST /v1/patients/:patientId/care-relationships` (`manage_patients` capability, unchanged) — the
  one new mechanism (§1). A lab-staff user assigns a clinician (by Keycloak `sub`) to a patient; this
  is how a `care_relationship` row comes to exist outside a test fixture for the first time.
- **`apps/api/src/critical-notification/critical-notification.controller.ts`**:
  - Extract the existing inline acknowledge logic (lines 118-156 today) into a new
    `critical-acknowledge.service.ts` (`acknowledgeCritical(tx, id, actorUserId, readBack)`),
    reused unchanged by the existing staff route and the new clinician route — same "authorization
    stays with the caller" split `OrderCreationService` already established (ADR-0027).
  - `list()` (today: any authenticated tenant user, zero scoping) gets the same conditional
    clinician-ABAC filter `PatientController.search()` already applies (join `criticalNotification
    .observationId` → `observation.patientId` → `relatedPatientIds`) — see Risks, this closes a real
    pre-existing gap, not something new to this task's own routes.
- **`apps/api/src/auth/capabilities.ts`**: three new capabilities, all granted only to `clinician`:
  `place_order_own_patient`, `view_related_patient_results`, `acknowledge_critical_own_patient`.
- **`apps/web/app/(clinician)/`**: new route group (own minimal layout, gated on the `clinician`
  role, same shape as FEAT-039's `(portal)` group) —
  `clinician/page.tsx` (the Doctor Dashboard: related-patient list + unacknowledged criticals +
  "place an order" entry point), `clinician/orders/new/page.tsx` (adapts
  `app/(app)/orders/new/order-builder-form.tsx`, patient dropdown restricted to the already-scoped
  `GET /v1/patients` response), `clinician/patients/[patientId]/results/page.tsx` (reuses
  `(portal)/portal/results/trend-chart.tsx`'s pattern against the new clinician results endpoint).
- No schema migration. `care_relationship`/`critical_notification`/`order`/`observation` all exist
  and are already RLS-covered; the new care-relationship-assignment endpoint writes to the same
  `care_relationship` table FEAT-040 already created and fixture-proved.

## 3. Architecture consulted
- KB-33 (Doctor Portal) — "relationship-based access... not the whole facility," "first-class
  ack/read-back endpoint... ties portal into result release," standalone-now/SMART-later.
- KB-10 (Authorization) — same RBAC (capability) + ABAC (row filter) two-layer model FEAT-039/040
  established; this task's three new capabilities follow that shape from the start, same as
  `view_own_results` did.
- ADR-0027 (one write path) — directly extended a second time: `OrderCreationService` (FEAT-036)
  already proved the pattern for orders; this task applies the identical shape to critical
  acknowledgement (`critical-acknowledge.service.ts`).
- `engineering/authz` Skill (FEAT-040, required per issue) — entries #1 (data-scope ≠ capability),
  #3 (dual-role principals get unscoped access), #4 (scoped-out = 404, never 403), #5 (new
  scoped table/role needs its own zero-state test + RLS fixture — not applicable here, no new table).
- `apps/api/src/auth/clinician-scope.ts` (FEAT-040) — `isClinicianOnly()`/`relatedPatientIds()`
  reused verbatim, unmodified, by all three new clinician routes.
- `apps/api/src/portal/portal-results.service.ts` (FEAT-039) — `getResultsForPatient(tx, tenantId,
  patientId)` already takes `patientId` as a plain parameter (not hardcoded to a self-lookup);
  reused directly by the clinician results route, substituting `resolveOwnPatientId` with a
  `relatedPatientIds` membership check.
- `app/(app)/orders/new/order-builder-form.tsx` — existing staff order-entry form, adapted (not
  rebuilt) for the clinician route.
- Stitch project `projects/17028784311825660113` ("Cloud-Native LIS UI Library" / "Clinical
  Precision" design system) — this repo's own existing design system, already used for prior staff
  screens; the new Doctor Dashboard screen (issue's "§3.8 Doctor Dashboard" requirement) is generated
  against this same design system for visual consistency, not a new one.

## 4. Skills loaded
- `engineering/authz` (required per issue) — §3 above.
- `engineering/api-design`, `engineering/database-design`.
- `domain/patient-identity`, `domain/fhir-mapping` (not directly used, checked for overlap — none).

## 5. Assumptions & autonomous decisions
- **No new column on `order` for "ordering clinician."** `order`'s own header comment (FEAT-006 §5)
  already scoped this out once; the standard `AuditInterceptor`/`@Audit()` trail already captures
  `actorPrincipalId` on every write, which is sufficient provenance for v1 — nothing in the AC needs
  a queryable "orders I placed" filter (visibility is patient-relationship-scoped, not
  placed-by-scoped). Revisit only if a future feature needs that filter. Confirmed in §10 Q1.
- **The existing `POST /v1/critical-notifications/:id/acknowledge` staff route is untouched** —
  same capability (`verify`), same unscoped behavior. The clinician route is additive, not a
  retrofit, matching FEAT-039's own precedent for not retrofitting the staff cumulative-report route.
- **`list()`'s new clinician-ABAC filter is in scope for this task**, not deferred — unlike the
  order-provenance question above, this isn't a "build ahead of need" case: it's a live gap
  (§6 Risks) that becomes materially exploitable the moment a `clinician`-role JWT exists in
  practice, which this task is what actually puts one to real use for the first time.
- **Reuse `test-user-7`** (FEAT-040's clinician fixture) for e2e — no new Keycloak user needed, only
  new `care_relationship` rows per test.
- **UI lives inside the existing `apps/web` app**, a new `(clinician)` route group — same "no new
  application yet" call FEAT-039 made, consistent with KB-33's own "standalone... later" framing
  referring to *packaging*, not necessarily a separate deployable today.

## 6. Risks
- **Pre-existing gap, found during this task's own research, not introduced by it**:
  `CriticalNotificationController.list()` has no capability gate and no ABAC filter — any
  authenticated tenant user (including a `clinician`, a role that has existed since FEAT-040 but had
  no reason to call this route until now) can already list every patient's criticals tenant-wide.
  Fixing it is in scope here (§2/§5) precisely because this is the first feature giving a clinician
  a real UI reason to reach this endpoint.
- **Care-relationship assignment is staff-initiated, not clinician self-service** — a clinician
  cannot request access to a patient; a lab-staff user must assign it first. Acceptable for v1 (same
  "prove the mechanism, defer real provisioning workflow" call FEAT-040 made for the table itself);
  flagged as a real limitation if a clinician's first patient interaction is time-sensitive.
- **Result-release-policy bypass for clinicians is a new, compliance-adjacent policy decision**, not
  a pure engineering choice — needs explicit sign-off, not an autonomous call (§10 Q2).
- A clinician with a related patient who has zero results yet, or zero unacknowledged criticals, is a
  real, valid empty state for the dashboard — must render as empty, not an error (same class of case
  as FEAT-039's own "zero eligible results" risk).

## 7. Acceptance criteria
(from issue #47, verbatim)
- [ ] A clinician can place an order, view a result, and acknowledge a critical without lab-staff
      involvement

## 8. Testing plan
- e2e (real Keycloak + Postgres): `test-user-7` (clinician) with a real `care_relationship` to a
  seeded patient proves: can place an order for that patient (200, real `order`/`ordered_test` rows
  created); cannot place an order for a same-tenant patient they're not related to (404); can view
  that patient's verified results immediately regardless of the tenant's `result_release_policy`
  delay setting; cannot view an unrelated patient's results (404); can acknowledge a critical on
  their own patient (200, `criticalNotification.status` flips, matching finalization-rollup then
  proceeds); cannot acknowledge an unrelated patient's critical (404); `list()` only returns their
  own patients' criticals, never a same-tenant unrelated one.
- e2e: the new `POST /v1/patients/:patientId/care-relationships` staff endpoint — a `manage_patients`
  caller can assign a clinician; a `clinician`-only caller is rejected (403, wrong capability).
- Unit tests: `critical-acknowledge.service.ts` in isolation (already-acknowledged conflict,
  successful transition) — same coverage shape as the extraction leaves behind.
- No new tenant-scoped table, so no new `rls-isolation-check.ts` fixture is needed.
- Manual: exercise the Doctor Dashboard, order placement, and critical acknowledgement as a real
  seeded `clinician` user against the locally running dev server (`web-verify` skill).

## 9. Rollback plan
Entirely additive except for two small, safe extensions to existing routes (`list()`'s new
conditional ABAC filter, `patient.controller.ts`'s new sub-resource route) — both no-ops for any
caller that isn't clinician-scoped. Rollback is removing the new module from `AppModule`, the new
route segment from `apps/web`, and reverting the two extended-route diffs.

## 10. Questions requiring human approval — RESOLVED 2026-08-10

1. **How does a clinician acquire a `care_relationship` to a patient in this task?**
   **RESOLVED: new staff-assign endpoint.** `POST /v1/patients/:patientId/care-relationships`
   (`manage_patients` capability, body `{ clinicianUserId: string }`) — the smallest change that
   makes the feature demoable end-to-end on staging without SQL.
2. **Should a clinician's result view bypass the patient-portal `result_release_policy` delay
   entirely, or should the same delay apply?** **RESOLVED: bypass entirely.** Clinicians see
   verified results the instant they're verified, same as internal staff today — the delay policy
   was designed for patient-facing visibility timing (FEAT-039 §10 Q1), not treating providers.
3. **No new `order.orderingClinicianUserId` column — is the standard audit-event trail sufficient
   provenance for v1?** **RESOLVED: yes, audit trail only.** No schema change — nothing in the
   stated AC needs a queryable "orders I placed" filter, and visibility is already
   patient-relationship-scoped.
