# Implementation Proposal: FEAT-065 — Patient merge
Status: APPROVED
ADR: ADR-0052 (status: accepted 2026-08-13)
Date: 2026-08-13    Backlog ID: #574 (FEAT-065, no epic — standalone gap closure found by codebase audit)

## 1. Goal

Build KB-02's own stated, unbuilt Patient-aggregate invariant: "patient merges are auditable and
reversible in effect (never destroy source identity)." A codebase audit (2026-08-13, this session)
found this gap directly — `patient-identity` Skill entry #6 already flagged it as real and unbuilt at
FEAT-011's own time, and nothing since has closed it. Two duplicate patient records, once each has
real clinical history attached, currently have no correction path.

## 2. Affected files

- `packages/db/src/schema/patient.ts` — new nullable self-referencing `mergedInto: uuid` column,
  `CHECK (merged_into IS NULL OR merged_into != id)`.
- `db/migrations/00XX_patient_merge.sql` (generated + hand-verified).
- `packages/domain/src/patient.ts`:
  - `patientSchema` gains `mergedInto: z.uuid().nullable()` (mirrors the new column exactly, per
    this file's own "mirrors the DB row 1:1" convention).
  - New `patientDetailSchema = { ...patientSchema.shape, mergedFrom: z.array(z.uuid()) }` — the
    `GET /v1/patients/:id` response shape only (a computed reverse lookup, not a stored column, so
    it does not belong on the plain `patientSchema` every other consumer reuses).
  - New `patientMergeRequestSchema = { loserPatientId: z.uuid(), reason: z.string().min(1) }` — a
    `reason` is required, matching `caseAmendRequestSchema`'s own "required for a correction"
    convention (FEAT-059).
- `apps/api/src/patient/patient.controller.ts`:
  - New `POST /v1/patients/:id/merge` (`:id` is the survivor) — `manage_patients` capability
    (reused, §10 Q2), one transaction: validates both patients (same tenant via RLS, distinct ids,
    neither already `mergedInto`-set), rejects 409 if both have a `patient_portal_account`, rewrites
    `patient_id` on `order`/`observation`/`patient_alert`/`care_relationship`/
    `patient_portal_account`/`billing.invoice` from loser to survivor, sets the loser's own
    `mergedInto`, writes one `audit_event` (`patient.merge`, `after` carrying both ids + a per-table
    row-count manifest).
  - `getById()` extended to also compute `mergedFrom` (a `SELECT id FROM patient WHERE merged_into =
    :id`) and return `patientDetailSchema` instead of `patientSchema`.
  - `search()`'s `q` (free-text) branch gains `isNull(patient.mergedInto)` — mirrors
    `worklist.controller.ts`'s own `ACTIVE_STATUSES` default-exclusion precedent. The `mrn`/
    `nationalId`/name+DOB exact-match branches are unchanged (a merged-away patient's own identifiers
    must still resolve directly to its own row, so a caller can follow `mergedInto`; TASK-040's
    duplicate-detection mode must keep seeing every row, ADR-0052 Decision 4).
- `apps/api/test/patient-merge.e2e-spec.ts` (new) — real Postgres, proves every ADR-0052 acceptance
  criterion.
- `patient-identity` Skill entry #6 updated from "unbuilt gap" to a real cross-reference once merged.

No new capability, no new table beyond the one column, no ADR touching Constitution Law #2's literal
text (ADR-0052 reasons from `patient-identity` Skill entry #5's own already-established interpretation,
extended one column, not a request to reinterpret the Law itself).

## 3. Architecture consulted

- **KB-02 Domain Model** — the Patient aggregate's own literal "patient merges are auditable and
  reversible in effect" invariant, the direct source of this feature.
- **Constitution (`five-invariants.md`) Law #2** ("verified clinical data is append-only... nothing
  is overwritten") and **Law #5** ("every clinically significant action is audited... in the same
  transaction as the change") — the two invariants ADR-0052 reconciles this feature against.
- **`domain/patient-identity` Skill** (full, 8 entries, already loaded this session) — entry #5's own
  "patient demographics are the subject of clinical data, not clinical data itself... `order.status`
  is the closest existing precedent for this class of non-Observation operational data" is the direct
  precedent ADR-0052 extends to `observation.patient_id`/`order.patient_id` (§Context, ADR-0052);
  entry #6 is this feature's own origin, entry #1 (fixed columns, not a generic identifier table)
  confirms `mrn`/`nationalId` themselves need no schema change, only ownership moves.
- **`engineering/database-design` Skill** (already loaded in full this session) — the CHECK-
  constraint-addition rule (re-consulted for `ck_patient_merged_into_not_self`) and the general
  "hand-verify a migration that isn't purely additive" discipline this migration needs (an `UPDATE`
  across six tables inside the merge transaction itself, not the migration — the migration only adds
  one nullable column + one CHECK, genuinely additive).
- **`packages/db/src/schema/observation.ts`** (re-read) — confirmed `patientId` is denormalized
  (ADR-0005/ADR-0015 comment), nullable (null for QC rows, which never need re-pointing since they
  have no patient at all), and is the exact column every trend/delta-check/cumulative-report/
  reference-range-resolution query filters on — the concrete reason ADR-0052 rejects a read-time-
  redirect design (§Alternatives rejected).
- **`packages/db/src/schema/{billing,patient-alert,care-relationship,patient-portal-account,order}.ts`**
  (re-read) — confirmed the complete, exhaustive list of six tables carrying a direct `patient_id`
  FK (grepped across every schema file, not assumed). Confirmed `case`/`specimen` (anatomic
  pathology) carry **no** direct `patient_id` — only transitively via `order.patient_id` — so
  rewriting `order.patient_id` alone correctly and completely propagates through AP without any
  separate touch to `case`/`specimen`.
- **`packages/db/src/schema/anatomic-pathology.ts`** (ADR-0051's own `caseReportVersion.supersededBy`
  self-FK) and **`packages/db/src/schema/observation.ts`** (ADR-0007's own `superseded_by`) — the
  direct precedent for `patient.mergedInto`'s own "old row stays, pointer moves forward" shape
  (ADR-0052 Decision 3).
- **`apps/api/src/patient/patient.controller.ts`** (re-read in full) — the exact existing
  `create()`/`search()`/`getById()`/`assignClinician()` conventions this feature's new route matches
  (explicit `ZodValidationPipe` per param, `manage_patients` capability, `{resourceId, before,
  after}` audited-mutation response shape, RLS-only tenant isolation, "never leak existence" 404
  convention).
- **`worklist.controller.ts`**/**`case.controller.ts`** (FEAT-063, this session) — the precedent for
  "exclude a terminal/no-longer-actionable state by default, no filter needed on the other query
  modes" that `search()`'s `q`-mode change reuses.

## 4. Skills loaded

`domain/patient-identity` (full, 8 entries — already loaded this session, re-consulted),
`engineering/database-design` (full, 17 entries — already loaded this session, re-consulted),
`engineering/rls-multi-tenancy` (already loaded this session, re-consulted — no new tenant-scoped
table this feature, only a column addition, so no new RLS policy is needed; confirmed the merge
transaction's own cross-table `UPDATE`s stay correctly tenant-scoped since RLS already restricts
every touched table to `current_setting('app.tenant_id')`).

## 5. Assumptions & autonomous decisions

- **Physical FK rewrite, not read-time redirect** (ADR-0052 Decision 1) — the central design
  decision; see the ADR's own §Context/§Alternatives rejected for the full reasoning. Presented again
  explicitly in §10 Q1 since it is the biggest call this proposal makes.
- **`patient_id` correction is not a Law #2 violation** — reasoned directly from `patient-identity`
  Skill entry #5's own already-established interpretation, not a request to reinterpret the
  Constitution itself. If you disagree with this reading, the entire physical-rewrite design (ADR-0052
  Decision 1) needs to be reconsidered, not just this one line — flagged explicitly, not buried.
- **Merge chains are rejected, not flattened** — merging into a patient whose own `mergedInto` is
  already set is rejected (400): "cannot merge into a patient that has itself been merged; merge into
  <the true current survivor> instead." Avoids ever needing multi-hop chain-walking logic anywhere.
  Same for a loser that is itself already a survivor-of-a-prior-merge target with its own
  `mergedInto` set — also rejected. A caller always merges directly into the current, live record.
- **`manage_patients` is reused for the merge capability** — no new capability invented, matching
  `create()`/`assignClinician()`'s own precedent (§10 Q2 for the alternative).
- **`audit_event`, not a new `patient_merge` table** (ADR-0052 Decision 5/Alternatives rejected) — no
  merge-history UI is named in this feature's own scope; `mergedFrom`/`mergedInto` on the ordinary
  `GET` response already surfaces the fact of a merge to any caller.
- **A true "undo merge" mechanism is out of scope** — the audit record makes reconstruction possible;
  automatic reversal is real, separate, likely-rare future work (ADR-0052 Consequences).

## 6. Risks

- **This is the first UPDATE this codebase has ever run across an already-verified `observation`
  row's own FK column** — mitigated by the explicit Skill-entry-#5-grounded argument in ADR-0052
  that `patient_id` is subject metadata, not clinical value, and by never touching any other column
  on that row (value/unit/range/flags/status/`superseded_by` chain all stay exactly as they were).
- **A six-table cross-referencing `UPDATE` inside one transaction is the largest single-transaction
  write this repo has attempted** — mitigated by real row-count assertions in the e2e test (before/
  after counts per table, not just "the API call returned 200") and by every touched table already
  being individually indexed on `(tenant_id, patient_id)` or equivalent, so the rewrite is not a
  full-table scan anywhere.
- **A merge is not literally undoable** — accepted per §5 above; flagged again here since it's a real
  operational risk (a wrong merge is a real, if auditable, mistake) worth your explicit awareness,
  not just a design footnote.
- **No merge UI exists** — this feature is API-only, matching FEAT-063/064's own "no new UI, this
  issue's own scope" precedent when there's no design-partner-driven UI requirement yet; a duplicate-
  review workflow is real, separate, future work (not filed as a follow-up issue in this proposal —
  §10 Q3 asks whether it should be).

## 7. Acceptance criteria

Per issue #574's own 5 ACs, each directly mapped to an ADR-0052 acceptance criterion (§7 there) —
not repeated verbatim here; see ADR-0052 for the precise, testable versions.

## 8. Testing plan

1. `pnpm --filter @lis/db generate` + hand-review the migration (one nullable column + one CHECK
   constraint — genuinely additive, no DROP/ADD needed unlike FEAT-063's `ck_case_status`).
2. `patient-merge.e2e-spec.ts`:
   - Full merge: two patients, each with a real order+observation+alert+care_relationship+invoice,
     merged; direct row-count assertions before/after on all six tables.
   - Loser's own row still exists post-merge, original fields intact, `mergedInto` set.
   - `GET` on the loser's own id returns 200 with `mergedInto` populated (not 404).
   - `GET` on the survivor returns 200 with `mergedFrom` including the loser's id.
   - A trend-relevant query (reuse `cumulative-report.e2e-spec.ts`'s own fixture shape) against the
     survivor, run after merging, includes the loser's pre-merge observations.
   - Both-have-a-portal-account rejection (409).
   - Merging into an already-merged-away id, and merging an already-merged-away id as the loser, both
     rejected (400).
   - Self-merge (`loserPatientId === id`) rejected (400).
   - `search(q: ...)` excludes a merged-away patient by default; `search(mrn: <loser's own mrn>)`
     still finds it directly (with `mergedInto` set).
   - Exactly one new `audit_event` row per merge, in the same transaction (reuse
     `case-sign-out.e2e-spec.ts`'s own `auditCount()` before/after helper pattern).
3. Re-run `patient.e2e-spec.ts`, `cumulative-report.e2e-spec.ts`, `cumulative-summary.e2e-spec.ts`,
   `clinician-portal.e2e-spec.ts`, `portal-results.e2e-spec.ts`, `billing.e2e-spec.ts` unmodified as
   regression checks (every one of these touches a table this feature's migration/route changes).
4. `pnpm --filter @lis/db rls-check` — no new tenant-scoped table, but re-run anyway per this
   session's own standing discipline.
5. Full local verification: fresh db-reset → new file in isolation → one final fresh-reset +
   full-suite run, strictly sequential.
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

The migration is purely additive (one nullable column, one CHECK constraint, no data touched) —
reverting the PR is a clean schema rollback with zero data-loss risk for any patient that was never
merged. For a patient that *was* merged before a rollback, the six-table `UPDATE`s already happened
and are not automatically reversed by reverting code — this is the same "not literally undoable"
limitation named in §5/§6/ADR-0052 Consequences, not a new risk introduced by rollback specifically.

## 10. Questions requiring human approval

1. **Physical FK rewrite onto the survivor, tombstoning the loser via `mergedInto`** (Recommended,
   ADR-0052 Decision 1-3, §5) — this is the proposal's central, largest decision, reasoned from
   `patient-identity` Skill entry #5's own existing "subject metadata, not clinical value"
   interpretation of Constitution Law #2 — versus a read-time-redirect design that never rewrites any
   existing row (rejected in the ADR as a permanent tax on every present/future query, see
   Alternatives rejected there for the full argument).
2. **`manage_patients` capability, reused unchanged** (Recommended, §5) — matching every other
   patient-administration action in this controller — versus a new, stricter capability given a merge
   touches six tables at once and is not trivially undoable.
3. **No merge-review UI is built or filed as a follow-up issue in this proposal** (Recommended,
   matches FEAT-063/064's own "API mechanism first, UI is separate scope" precedent) — versus filing
   a real follow-up issue now (mirroring the EPIC-012 follow-up backlog's own discipline of "real,
   named future work, each its own filed issue — not silently dropped") so a duplicate-review
   workflow doesn't get lost as unlinked prose.

**Do not begin implementation until Status above is changed to APPROVED.**
