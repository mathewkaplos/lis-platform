# Implementation Proposal: FEAT-018 QC materials & results as Observations
Status: **FULLY IMPLEMENTED** — both tasks merged. TASK-063 (PR merged, #350) and TASK-064 (below,
#351). FEAT-018 (#27) itself still needs its own manual-comment close — bare `Closes` lines don't
auto-close a parent feature issue, the same recurring gotcha every prior feature has hit.
ADR: adr-0015 (accepted 2026-08-07 — see §10 Q1)    Date: 2026-08-07    Backlog ID: FEAT-018 (#27) / TASK-063 (#350) / TASK-064 (#351)

**TASK-063 (Control lot & QC observation schema), 2026-08-07.** All three §10 questions resolved
via the native options-prompt, recommended option chosen for each: ADR-0015 accepted as drafted;
`enter_result` reused (no new capability); TASK-063/TASK-064 created as real GitHub issues (#350,
#351). Delivered exactly per §2's affected-files list: `control_lot` table (migration
`0016_control_lot_and_observation_qc_subject.sql`), `observation`'s `isControl`/`controlLotId` +
nullable `patientId`/`orderedTestId`/`specimenId` + `chk_observation_subject`.

**Real finding during implementation, not anticipated in §5/§6:** Postgres only permits
table-qualified column references (`"observation"."col"`) inside a CHECK clause that's part of the
same `CREATE TABLE` statement — this table's original ten `ck_observation_*_value` constraints get
that for free (embedded in `0004_observation.sql`'s own `CREATE TABLE`), but `chk_observation_subject`
is added later via a standalone `ALTER TABLE ... ADD CONSTRAINT`, where a qualified reference errors
with "missing FROM-clause entry for table observation" — confirmed by a real failed migration run,
not assumed. Fixed by writing the new constraint with bare (unqualified) column names instead of
this file's usual `${table.column}` interpolation; documented inline in `observation.ts` so the next
person adding a post-creation CHECK constraint to this table doesn't rediscover it.

**Second real finding:** widening `observation`'s nullability (per ADR-0015's own Consequences
section) broke real, existing type-checking in `observation.controller.ts`'s `toObservationDto`/
`toPriorObservationDto` — both read `row.orderedTestId` and assign it into a domain type that still
requires it non-null (correctly — every route these mappers serve only ever reads patient-flow rows,
never a QC row). Fixed with a narrow non-null assertion at each site, commented with why it's safe
there specifically (ADR-0015's own predicted widening, not a new gap).

**Third real finding:** `rls-isolation-check.ts`'s own structural sweep auto-discovers every
tenant-scoped table generically (via `information_schema`), so `control_lot` was picked up
immediately — but its live leak check failed until a `control_lot` fixture was added to
`insertFixtures()` (no fixture ⇒ "tenant A has 0 rows — cannot prove isolation"), the same gap
`report` (TASK-059/060) already has and this task does not fix (out of scope, unrelated table).

Verified: real migration applied against local Postgres (`pnpm db:reset`, drop/recreate — no
production data exists at this milestone, ADR-0015's own rollback precondition); a re-run of
`drizzle-kit generate` immediately after confirmed "No schema changes, nothing to migrate"; the new
`apps/api/test/control-lot.e2e-spec.ts` (RLS isolation + both valid/invalid CHECK shapes) plus the
full existing `apps/api` e2e suite, 157/157 on a clean DB; `pnpm --filter @lis/db rls-check` and
`golden-check` both green on a clean DB (the RLS script's own "4 leaks" on a *non-clean* run were
confirmed as legitimate cross-tenant fixture data from `order.e2e-spec.ts`'s own `TENANT_B`, not a
real leak — re-confirmed clean immediately after a fresh `db:reset`); repo-wide `typecheck`/`lint`/
`build` green, including a real `next build`/`nest build`.

## 1. Goal

M4 (Chemistry Result Loop, the thesis milestone) closed in full last session — FEAT-014/015/016/017
all merged, verified, deployed. M5 ("Make It Dependable — QC, criticals, Haematology") has 8 open
features, none started. FEAT-018 (#27) is M5's first feature and its own stated dependency
(FEAT-016, Minimal report) is already merged, so it's the correct entry point.

FEAT-018's issue text names two ACs: "A QC result on a control material persists as an Observation
with the correct linkage to the control lot" and "QC results are queryable independently of patient
results but share the same underlying engine." Its Tasks section is explicitly unstarted: "Not yet
decomposed — this feature belongs to a rolling-wave milestone and will be broken into tasks at its
milestone kickoff." **This proposal's job is that kickoff decomposition, plus this proposal's own
approvable scope narrowed to the first task only** — the same narrowing precedent every prior
feature in this repo has used (FEAT-014's five revisions, FEAT-015's four, FEAT-017's two).

**Task decomposition (drafted this session, not yet created as GitHub issues — see §10 Q3):**
- **TASK-063 — Control lot & QC observation schema.** This proposal's scope. Delivers the
  `control_lot` table and the `observation` schema changes ADR-0015 specifies (nullable
  `patientId`/`orderedTestId`/`specimenId`, new `isControl`/`controlLotId`, the CHECK constraint),
  with RLS coverage and migration up/down proven. No HTTP surface — service/schema only, matching
  every prior feature's own "service first, consumer later" precedent (TASK-045/049/059).
- **TASK-064 — QC result entry & query API.** Depends on TASK-063. A write path that inserts a QC
  Observation linked to a `control_lot` (reusing the `enter_result` capability per ADR-0015), and a
  read path proving the literal "queryable independently of patient results" AC. Not this proposal's
  scope — to be specified as this file's first revision once TASK-063 is real, the same
  "TASK-050–053 specified once TASK-049 exists" precedent FEAT-014 used.

**Real, load-bearing finding from this proposal's own research, not present in FEAT-018's issue
text:** KB-27's own core design statement — "a QC result is measured and stored exactly like a
patient result... an Observation whose subject is a control material, not a patient" — is not
buildable against the schema as it exists. `observation.patientId`/`orderedTestId`/`specimenId` are
all `NOT NULL` today (confirmed by direct inspection of
`packages/db/src/schema/observation.ts`); a QC insert with no patient, no order, and no specimen
would violate three constraints. This is a genuine schema-shape decision, not an implementation
detail — **ADR-0015** (drafted alongside this proposal, Status: proposed) resolves it: an explicit
`isControl` discriminator, a new `controlLotId` FK, and the three existing columns relaxed to
nullable, enforced by a CHECK constraint so every row is unambiguously a patient result or a QC
result, never neither, never both. TASK-063 cannot start until ADR-0015 is accepted (§10 Q1).

**Second finding:** no `instrument`/`equipment` table exists anywhere (KB-28 unbuilt). ADR-0015's
`control_lot.instrumentId` deliberately mirrors `observation.instrumentId`'s own already-precedented
"bare nullable uuid, no FK" gap rather than inventing new scope. `domain/qc-westgard` Skill entry #2
has the full detail.

**Third finding:** FEAT-018 must not grow into FEAT-019 (Westgard rule evaluation) or FEAT-020 (the
release gate) — KB-27's own pipeline names these as later, dependent stages. TASK-063/064 deliver
only the data model and persistence; no rule evaluation, no hold/gate logic. `domain/qc-westgard`
Skill entries #3-4 record this narrowing explicitly.

## 2. Affected files

- `lis-engineering/adr/adr-0015-qc-observations-share-the-observation-table-via-nullable-subject-columns.md`
  (new, this session) — must be **accepted** before this task's migration is written (§10 Q1).
- `packages/db/src/schema/control-lot.ts` (new) — `control_lot` table per ADR-0015: `id`,
  `tenantId`, `analyteId` (FK → `analyte.id`), `level` (text), `instrumentId` (nullable, no FK, per
  ADR-0015/Skill entry #2), `unitId` (FK → `unit.id`), `targetMean`/`targetSd` (numeric), `lotNumber`
  (text), `expiresAt` (nullable timestamp tz), `createdAt`. Tenant-scoped, RLS via the standard local
  `tenantIsolation()` helper every tenant table in this schema repeats (`reference-range.ts`/
  `report.ts` precedent).
- `packages/db/src/schema/observation.ts` (modify) — `patientId`/`orderedTestId`/`specimenId` become
  nullable; new `isControl: boolean NOT NULL DEFAULT false`; new `controlLotId: uuid nullable FK →
  control_lot.id`; new CHECK constraint `chk_observation_subject` per ADR-0015.
- `packages/db/src/index.ts` — export `control_lot` schema.
- `db/migrations/00XX_control_lot_and_observation_qc_subject.sql` (new, hand-written per this
  table's existing convention for CHECK constraints/RLS — `database-design` Skill's standing
  precedent) — creates `control_lot`, alters `observation`.
- `apps/api/test/control-lot.e2e-spec.ts` (new) — real-Postgres RLS isolation test for `control_lot`
  (negative test: wrong-tenant session sees 0 rows, connected as `lis_app`), plus a direct-insert
  proof that the `chk_observation_subject` CHECK constraint rejects both invalid shapes (patient row
  with `controlLotId` set; QC row with `patientId` set) and accepts both valid shapes.
- No controller, no domain Zod schema, no new capability this task — matches TASK-063's own
  "schema only" scope; TASK-064 is the first real caller.

## 3. Architecture consulted

- KB-27 Quality Control — primary; the "Observations on control materials" core design and the
  `control_lot` conceptual shape.
- ADR-0015 (this session) — the concrete schema mechanism.
- ADR-0007 (observation correction linkage) / ADR-0008 (observation partitioning) — precedent for
  how prior schema-shape decisions on this exact table were structured and reviewed.
- KB-28 Equipment Management — confirms the `instrumentId` gap is real, known, future scope, not an
  oversight.
- `domain/qc-westgard` Skill (new, this session) — the primary Skill for this and all QC work.

## 4. Skills loaded

- `domain/qc-westgard` (new, drafted this session) — primary.
- `engineering/database-design` — hand-written-migration/CHECK-constraint precedent (this table
  already has ten dataType-driven CHECK constraints in the same style).
- `engineering/rls-multi-tenancy` — new tenant-scoped table pattern.
- `engineering/testing` — real-Postgres RLS negative-test precedent.
- `domain/result-verification` — loaded to confirm the append-only trigger (`fn_observation_append_only`,
  ADR-0007) is unaffected by this change (its `WHERE OLD.status = 'verified'` condition doesn't
  reference `patientId`/`isControl`, confirmed by inspection) — QC rows get the same append-only
  guarantee as patient rows, no separate logic needed.

## 5. Assumptions & autonomous decisions

- **QC result entry reuses the existing `enter_result` capability, no new capability.** Per
  ADR-0015 — same real-world actors, no stated need for QC-only role separation anywhere in KB-27 or
  the FEAT-018/019/020/021 issue bodies. Not raised as an open question: this is a clear "don't add
  speculatively" case, not a genuine tradeoff.
- **`control_lot.level` is plain text, not an enum, at this stage.** No rule-pack metadata exists
  yet (FEAT-019's own later scope); constraining it to a fixed enum now would be speculative given
  KB-27 itself only describes level informally ("low/normal/high" as an example, not a canonical
  set). Revisit once FEAT-019 needs a real, tighter type.
- **`control_lot.instrumentId` has no FK, mirroring `observation.instrumentId`.** Per ADR-0015 — an
  intentionally consistent, already-precedented gap, not a new one.
- **This task is schema/migration only — no HTTP surface, no seed data.** Matches every prior
  "service first, consumer later" task in this repo (TASK-018, TASK-045, TASK-049, TASK-059).
  TASK-064 is the first real caller and the first place synthetic QC fixtures get created (per
  `domain/qc-westgard` Skill entry #6).

## 6. Risks

- **ADR-0015 is not yet accepted.** This is the single blocking dependency for this entire task —
  raised explicitly as §10 Q1, not assumed approved by proceeding to write the proposal alongside it.
- **Widening the central `observation` table's nullability is a permanent, repo-wide contract
  change.** Every future reader that assumed `patientId` is always present is now wrong unless it
  filters `isControl = false`. This proposal's own testing plan (§8) proves the *existing* patient
  write/read paths are unaffected, but cannot exhaustively audit every future consumer — flagged in
  ADR-0015's own Consequences section as a standing fact for future task authors, not something this
  task can fully close out.
- **No real QC/control-lot data exists anywhere to validate against** (`domain/qc-westgard` Skill
  entry #6) — this task's correctness rests on synthetic fixtures and the CHECK constraint's own
  logic, not partner-reviewed data. Lower risk than the reference-range age/method gap, since this
  task makes no clinical-value claims (target mean/SD are lab-configured metadata, not patient
  results) — but worth stating plainly rather than silently glossing over.

## 7. Acceptance criteria

Narrowed to TASK-063's own schema scope (TASK-064 will carry FEAT-018's full literal AC):
- [ ] `control_lot` exists, tenant-scoped, RLS-enforced (negative test: wrong-tenant session sees 0
  rows via `lis_app`), with a real FK to `analyte`.
- [ ] `observation.isControl`/`controlLotId` exist; `patientId`/`orderedTestId`/`specimenId` are
  nullable; `chk_observation_subject` exists and is enforced both directions (negative test on each
  invalid shape).
- [ ] Every existing patient-flow write path (`draft()`, `finalize()`, `verify()`) is unaffected —
  the full existing `apps/api` e2e suite passes unchanged.
- [ ] A direct-insert QC-shaped row (`isControl = true`, `controlLotId` set, the other three subject
  columns null) succeeds and round-trips correctly.
- [ ] Migration runs up **and** down cleanly on seeded data (per FEAT-018 issue's own Database work
  checklist item).

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `control-lot.ts` module and the modified
   `observation.ts`.
2. `apps/api/test/control-lot.e2e-spec.ts`, real Postgres, connected as `lis_app`:
   - RLS isolation: a `control_lot` row created under tenant A is invisible to a tenant B session.
   - CHECK constraint, both invalid shapes rejected: (a) `isControl = false` with `controlLotId` set
     and `patientId` also set (contradiction), (b) `isControl = true` with `patientId` set (should be
     null). Both valid shapes accepted: ordinary patient row (unchanged from today), QC row (new).
3. The full existing `apps/api` e2e suite re-run and confirmed still green — proves zero regression
   to any patient-flow write/read path from the nullability relaxation.
4. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including a real `next build`/`nest
   build`.
5. Migration down/up cycle run locally against seeded data, confirmed clean (per this repo's
   standard `pnpm db:reset` verification).

## 9. Rollback plan

Additive for `control_lot` (new table, drop it). The `observation` changes are a genuine schema
widen, not purely additive — reverting requires re-tightening `patientId`/`orderedTestId`/
`specimenId` back to `NOT NULL` (only valid if no QC row has been written yet, true at this
milestone per FEAT-018/019/020's own sequencing) and dropping `isControl`/`controlLotId`/the CHECK
constraint. No production data exists at this milestone (same precondition ADR-0008 relied on for
its own drop/recreate approach) — rollback is reverting the PR and the migration cleanly, with no
data-preservation concern.

## 10. Questions requiring human approval

1. **Is ADR-0015 (QC observations share the `observation` table via nullable subject columns)
   approved as written?** This blocks TASK-063 entirely — no migration should be written against an
   unaccepted schema decision. Recommended: accept as drafted; it's the direct, minimal-alternatives
   mechanism for KB-27's own already-settled design, not a fresh architectural choice being smuggled
   in.
2. **Is `enter_result` the right capability for QC result entry, or should FEAT-018 introduce a
   dedicated QC capability now, ahead of any stated need?** Recommended: reuse `enter_result` (§5) —
   no real requirement for QC-only role separation exists anywhere in the KB or issue bodies today.
3. **Should TASK-063/TASK-064 be created as real GitHub issues now** (via
   `github/issues/tasks/TASK-063-*.md`/`TASK-064-*.md` + `manifest.json` + `import-to-github.sh`,
   the same mechanism that created every existing TASK issue in this repo), **or should that wait
   until this proposal itself is approved?** This is a real, visible, shared-state action (issue
   numbers, notifications) — flagged separately from code-writing approval per this session's own
   general caution about actions visible to others. Recommended: create them now, alongside proposal
   approval — matches how every prior feature's kickoff session in this repo has sequenced it, and
   TASK-063's own dependency references need a real issue number to link against.

---

## TASK-064 (Control lot & QC result entry/query API) — revision, 2026-08-07

`GET/POST /v1/control-lots/:id/results` — TASK-063's first real HTTP caller, and `control_lot`'s
first real consumer. The human asked for TASK-064 by name (continuing directly from TASK-063, no
new `/orient` cycle), so this revision documents the design decisions made during implementation
rather than re-running the full open-questions options-prompt — none of them were genuinely
ambiguous enough to need one; each is a direct application of an already-established precedent,
stated below with its reasoning rather than silently assumed.

**Route shape:** `POST v1/control-lots/:id/results` (record), `GET v1/control-lots/:id/results`
(list) — the same `/resource/:id/sub-resource` shape `observation.controller.ts` already uses for
patient results, per `engineering/api-design` entry #11 (slash, not KB-08's literal colon-suffix
syntax, which doesn't survive this repo's real stack).

**No draft/finalize split — every POST is a new row, audited unconditionally.** A patient's
ordered-test analyte has one current result per analyte (upsertable); a control lot's QC history is
a genuine time series — every run is a real, distinct data point FEAT-019's future Levey-Jennings
charting needs in full, not just the latest. So `recordResult()` is a plain `INSERT`, never an
`UPDATE`, and always audited (no unaudited "draft" concept applies here, unlike `draft()`'s
unaudited autosave for patient results) — matches ADR-0015's own Consequences note that QC entry
should be audited the same way patient result entry is.

**Request/response schemas (`packages/domain/src/control-lot.ts`, new):** the request body reuses
`resultEntrySchema` verbatim (quantity/coded/text, same discriminated union TASK-051 already built)
rather than defining a parallel one — same real-world data shapes. The response
(`qcObservationSchema`) is deliberately smaller than `observationSchema`: no `refLow`/`refHigh`/
`flags`/verification fields, since reference-range resolution and flagging are patient-specific
concepts (KB-15) that don't apply to a control material's target mean/SD — that evaluation is
Westgard's own job (FEAT-019), not built here.

**Real bug found during implementation, not anticipated in this revision's own first draft:**
`AuditInterceptor` requires its wrapped handler return an `AuditedMutationResult`
(`{ resourceId, before?, after? }`, the exact shape `finalize()`/`verify()` already return) — not a
flat DTO. `recordResult()`'s first draft returned `toQcObservationDto(inserted)` directly (an object
with `id`, no `resourceId`), which compiled fine (both are plain objects) but produced a real 500 at
request time: `writeAuditEvent`'s `resourceId` column is `NOT NULL`, and the interceptor read
`result.resourceId` as `undefined`. Caught by this task's own e2e suite, not by inspection — fixed
by returning `{ resourceId: after.id, before: null, after }`, matching every other audited route's
shape exactly, and removing the `@ZodResponse` annotation `recordResult()` had incorrectly carried
(the audited-route convention, per `finalize()`/`verify()`, is no fixed response-schema binding for
this shape).

**Second real finding:** a hand-crafted fake UUID (`00000000-0000-0000-0000-0000000000ff`) for a
"control lot does not exist" 404 test failed Zod's `z.uuid()` validation itself (400, not 404) —
Zod validates real UUID version/variant bits, which an all-zeros-plus-suffix string doesn't satisfy.
Fixed by using `randomUUID()` for the nonexistent-id case, matching every other spec's own existing
precedent for this exact test shape (`patient.e2e-spec.ts`, `observation.e2e-spec.ts`).

Delivered: `apps/api/src/control-lot/control-lot.controller.ts` + `control-lot.module.ts`
(registered in `app.module.ts`), `packages/domain/src/control-lot.ts`. `openapi.json`/
`packages/sdk/src/schema.ts` regenerated for both new routes (CI-enforced since PR #343).

Verified: 6 new HTTP-level e2e tests (401 unauthenticated, a QC result recorded with the correct
`controlLotId`-not-`orderedTestId`/`patientId` shape and confirmed audited against the real
persisted `audit_event` row, a `dataType` mismatch rejected 400, a nonexistent control lot 404, a
cross-tenant control lot 404 per `engineering/api-design` entry #7, and multiple POSTs against the
same lot proven to accumulate as a real time series rather than overwrite) alongside TASK-063's own
5 schema-level tests, 11/11 in `control-lot.e2e-spec.ts`; full `apps/api` e2e suite 163/163 on a
clean DB, zero regression; `rls-check`/`golden-check` both green (the `report` table's own
pre-existing fixture gap in `rls-isolation-check.ts`, unrelated to this task, left as-is); repo-wide
`typecheck`/`lint`/`build` green, including a real `next build`/`nest build`.

**FEAT-018 (#27) is now fully implemented — both named tasks merged.** Not yet closed via the
standard manual comment (bare `Closes` lines never auto-close a parent feature issue) — a real next
step, not done as part of this task's own implementation work.
