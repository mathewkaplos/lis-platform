# Implementation Proposal: FEAT-063 — Cytology two-tier workflow (screen → review → sign-out)
Status: APPROVED
ADR: none (fits within existing role/capability model — see §5)
Date: 2026-08-13    Backlog ID: #542 (FEAT-063, depends on FEAT-062 #541, FEAT-029, FEAT-009/FEAT-040)

## 1. Goal

Cytology's characteristic workflow: screening (cytotechnologist) → review → cytopathologist
sign-out for cases requiring it, tiering and sign-out authority enforced by role. Unlike FEAT-062
(a pure content/protocol addition), this is a genuine new mechanism: a new `case.status` value, a
new `screen()` action gating `finalize()`, and a new case-list route for worklist visibility — the
first real change to FEAT-057's own case state machine since it shipped.

**Which case categories require two-tier review is deliberately configurable, not hardcoded**
(issue's own framing, deferred to issue #552) — this proposal ships a real, fixed v1 default
(cytology specimens require it, histology doesn't), not per-tenant configurability, matching #552's
own explicit "left as a deferred follow-up" scope cut.

## 2. Affected files

- `packages/db/src/schema/anatomic-pathology.ts` — `caseTable`'s `ck_case_status` CHECK constraint
  gains `'pending_review'`, between `in_process` and `signed_out`:
  `accessioned → in_process → pending_review (screened, awaiting cytopathologist) → signed_out |
  amended`. A CHECK constraint change requires `DROP CONSTRAINT`/`ADD CONSTRAINT` (cannot be
  altered in place) — a real, hand-verified migration, not just a `drizzle-kit generate` diff.
- `packages/domain/src/anatomic-pathology.ts` — `caseStatusSchema` gains `'pending_review'`; new
  `caseListQuerySchema`/`caseListItemSchema`/`caseListResponseSchema` for the new list route.
- `apps/api/src/case/case.controller.ts`:
  - `finalize()`'s existing lineage-completeness check (every part ≥1 active block, every block
    ≥1 active slide) extracted into a shared private method, reused by the new `screen()` below —
    not duplicated.
  - New `POST v1/cases/:id/screen` — transitions `in_process`/`accessioned` → `pending_review`.
    `manage_specimens` capability (same as every other AP mutation route, §5), **no step-up** —
    screening is a routine tier transition, not the diagnostic release ADR-0051 scopes step-up to
    (§5/§10 Q3). Rejects (400) a case whose specimens don't require two-tier review at all (a
    histology case has nothing to "screen" — it goes straight from `in_process` to `finalize()`,
    unchanged).
  - `finalize()` modified: if the case requires two-tier review (§5's own specimen-type-derived
    default) and `status !== 'pending_review'`, reject (400, "must be screened first"). If the case
    does **not** require two-tier review (histology), `finalize()` behaves exactly as FEAT-057/059
    already built — no new precondition, no regression.
  - New `GET v1/cases` — a live, query-driven list (KB-26's own "worklist = live query" principle,
    `WorklistController`'s own established shape, applied to cases instead of `ordered_test` — this
    repo's **first** case-listing endpoint of any kind; only single-case `GET /v1/cases/:id` exists
    today). Filterable by `status` — `?status=in_process` is the cytotechnologist's screening
    queue, `?status=pending_review` is the cytopathologist's review/sign-out queue. Satisfies AC #3
    without a new Task-record mechanism (§5/§10 Q4).
- `apps/api/src/case/case-tiering.ts` (new) — `requiresTwoTierReview(specimenTypes: string[]):
  boolean`, a small pure function (unit-testable without a database, matching
  `reflex-guardrails.ts`'s own "pure gate, DB-free" split) checking specimen types against a fixed
  v1 list (`CYTOLOGY_SPECIMEN_TYPES = ['cervical_cytology']`, extensible later — not
  tenant-configurable, issue #552's own deferral).
- `db/migrations/00XX_case_pending_review.sql` (hand-verified DROP/ADD CONSTRAINT).
- `apps/api/src/case/case-tiering.spec.ts` (new) — unit coverage for the pure tiering function.
- `apps/api/test/cytology-two-tier.e2e-spec.ts` (new) — all three issue ACs against a real
  Postgres/Keycloak instance: screen → review → sign-out with real role enforcement, a
  cytotechnologist-only token rejected on `finalize()`, `GET /v1/cases?status=...` reflecting the
  right cases for the right query, and a histology case's own unmodified single-tier path
  (regression coverage for the `finalize()` change).

No new table, no new capability (§5), no new ADR.

## 3. Architecture consulted

- **KB-18 Cytology** (already read in full, FEAT-062) — "screening (cytotechnologist) → review →
  cytopathologist sign-out for cases requiring it, with the tiering and sign-out authority enforced
  by authorization... driven by workflow tasks."
- **KB-25 Workflow Engine** (already read in full, FEAT-060/061) — re-consulted for whether this
  feature should be modeled as workflow-engine rules/commands (like reflex) rather than plain
  controller code. Resolved **no** (§5): KB-25's own engine is for *event-reactive automation*
  (a rule fires when an event happens); screen/finalize are *human-initiated actions* a caller
  directly requests, the same shape every other AP mutation route (`case.controller.ts`) already
  is — there is no "event" here for a workflow rule to react to, just a state transition a human
  performs, gated by capability, exactly like every other route in this controller.
- **KB-26 Task Management** (read in full this session) — the load-bearing distinction: "Worklist =
  a live query over operational state... Task = a discrete, tracked unit of work" with its own
  identity/assignee/SLA/audit trail. Routine screening work is the **worklist** case ("ambient flow
  of routine work"), not the **task** case (reserved for "exceptions and safety-critical items" —
  a critical-value callback, a recollection). No `task` table or mechanism exists anywhere in this
  codebase yet (confirmed by grep) — building one from scratch is a real, separate, much larger
  KB-26 implementation this issue's own ~4-day estimate does not scope. AC #3's literal "appears on
  the correct role's worklist" is satisfied by a real, live, role-visible query (the new `GET
  v1/cases` route), matching KB-26's own lighter mechanism for exactly this kind of routine flow.
- **`apps/api/src/worklist/worklist.controller.ts`** (re-read in full) — the existing
  `ordered_test`-status-shaped worklist confirmed to be a different resource entirely (chemistry's
  own per-panel flow) — extending it to also cover case-level cytology screening would conflate two
  structurally different resources; a new, parallel `GET v1/cases` route on `case.controller.ts`
  itself keeps the two worklist shapes independently reasoned about, mirroring how
  `operational-reports.controller.ts` added a fourth route rather than reshaping an existing one.
- **`engineering/authz` Skill** (full, 7 entries, loaded this session) — entry #1's own "a data-scope
  filter is not a capability" distinction: `screen()`/`finalize()`'s role enforcement here **is** a
  capability question (may this role perform this action), not an ABAC/relationship-scope one — the
  existing `RequireCapability`/`CapabilityGuard` mechanism applies unchanged, this Skill's own
  relationship-scoping machinery (`clinician-scope.ts`) is not relevant to this feature at all.
- **`engineering/workflow-engine` Skill** (full, 17 entries, already loaded this session) —
  confirms this feature adds no new `WorkflowCommandRegistry` handler and no new trigger event,
  consistent with §3's own "not a workflow-engine feature" finding above.
- **`apps/api/src/auth/capabilities.ts`** (re-read) — confirmed `manage_specimens` is granted to
  both `technologist` and `verifier`, `verify` only to `verifier` — AC #2 ("a cytotechnologist
  cannot sign out a case requiring cytopathologist review") is **already true by construction**
  once `screen()` is gated by `manage_specimens` and `finalize()` stays gated by `verify`
  (unchanged from FEAT-059) — no new capability needed, confirmed by direct re-reading, not assumed.
- **`apps/api/src/case/case.controller.ts` `finalize()`** (re-read in full) — the exact
  lineage-completeness check being extracted and reused, and the exact insertion point for the new
  `pending_review` precondition.
- **`engineering/database-design` Skill** (already loaded in full this session) — entry #9's own
  "a CHECK constraint added via `ALTER TABLE ADD CONSTRAINT` cannot table-qualify column names"
  rule, directly load-bearing here since `ck_case_status` needs a real `DROP`/`ADD` migration, not
  a `drizzle-kit generate` diff alone.

## 4. Skills loaded

`engineering/workflow-engine` (full, 17 entries — already loaded this session, re-consulted),
`engineering/authz` (full, 7 entries), `engineering/database-design` (full, 17 entries — already
loaded this session, re-consulted for the CHECK-constraint-alteration rule).

## 5. Assumptions & autonomous decisions

- **Two-tier requirement is derived from specimen type, not a new `case` column or tenant
  configuration.** `requiresTwoTierReview()` checks each part's `specimenType` against a fixed,
  small, in-code list (`['cervical_cytology']`, FEAT-062's own seeded specimen type) — a real,
  working v1 default, not per-tenant configurability (issue #552's own explicit deferral: "which
  case categories require cytopathologist sign-out vs. cytotechnologist-only screening is
  deliberately configurable... left as a deferred follow-up"). A future feature can move this into
  real tenant-configurable metadata without changing `screen()`/`finalize()`'s own call sites,
  only `requiresTwoTierReview()`'s own implementation.
- **`screen()` requires no step-up.** ADR-0051 scopes step-up + digital signature to the actual
  diagnostic release (`finalize()`/`amend()`), not every state transition leading up to it — a
  cytotechnologist's screening pass is real, audited work but not the moment of clinical
  attestation. Reusing `StepUpGuard` here would be a scope expansion beyond what ADR-0051 itself
  decided, not a reuse of an existing pattern.
- **No new Task-record mechanism** (§3) — a live `GET v1/cases?status=...` query satisfies AC #3's
  literal wording, matching KB-26's own "worklist" (not "task") classification for routine flow
  work. Building a real `task` table/lifecycle (open→assigned→in_progress→completed, KB-26's own
  described shape) is real, separate, much larger scope this issue's own estimate does not cover.
- **No new capability.** `manage_specimens` (screen) and `verify` (sign-out) already correctly
  encode the tiering authority this feature needs — confirmed by direct re-reading of
  `capabilities.ts`, not assumed.
- **This is not a workflow-engine feature** (§3) — no new `WorkflowCommandRegistry` handler, no new
  trigger event. Screen/finalize are human-initiated actions on an existing controller, the same
  shape as every other AP mutation route.
- **`GET v1/cases`'s own default (no `status` filter) is deliberately left unresolved by this
  proposal** — flagged in §10 rather than guessed, since a sane "show me everything active" default
  has real design tradeoffs (should `signed_out`/`amended` cases show by default? Almost certainly
  not, matching `WorklistController`'s own `ACTIVE_STATUSES` precedent of excluding terminal
  states from the default view) that deserve an explicit decision, not a silent one.

## 6. Risks

- **`finalize()`'s new precondition is a real behavior change for existing histology cases** —
  mitigated by scoping the new check to `requiresTwoTierReview(...) === true` only; a histology
  case's own code path is provably unchanged (verified directly in §8, not just argued), and
  `case-sign-out.e2e-spec.ts`'s own existing histology tests are re-run unmodified as a regression
  check.
- **A CHECK-constraint DROP/ADD migration against a live table** is a real, slightly more invasive
  migration shape than this session's prior additive-only AP migrations (FEAT-057/059/061 all only
  ever added new tables) — verified directly against real Postgres (§8), including that existing
  `signed_out`/`amended` rows are unaffected by the constraint swap.
- **No real cytotechnologist/cytopathologist Keycloak roles exist** (only `technologist`/
  `verifier`) — same "no dedicated role yet" gap every other AP feature this session has
  documented and deliberately not solved (a real, separate Keycloak-provisioning decision, out of
  this proposal's own scope, same as `case.controller.ts`'s own existing header comment already
  states for `manage_specimens`).

## 7. Acceptance criteria

Per issue #542's own 3 ACs:
- [ ] A cytology case flows screen → review → sign-out with each transition enforced by role —
  proven by a real `screen()` call (manage_specimens-gated) followed by a real `finalize()` call
  (verify-gated), both succeeding in sequence, and `finalize()` rejecting a `pending_review` case's
  own state precondition if attempted out of order.
- [ ] A cytotechnologist cannot sign out a case requiring cytopathologist review — proven by a real
  `manage_specimens`-only (no `verify`) token rejected (403) on `finalize()`, matching the existing
  capability model, not new code.
- [ ] The screening tier's own task appears on the correct role's worklist — proven by `GET
  v1/cases?status=in_process` (cytotechnologist's queue) including a real unscreened case and `GET
  v1/cases?status=pending_review` (cytopathologist's queue) including it only after `screen()`
  succeeds.

## 8. Testing plan

1. `pnpm --filter @lis/db generate` + review the migration diff (the `DROP CONSTRAINT`/`ADD
   CONSTRAINT` pair, not a table change) — hand-verify it runs cleanly against the real, already-
   migrated local database (existing `case` rows with `signed_out`/`amended` status must survive
   the constraint swap unaffected).
2. `case-tiering.spec.ts` — `requiresTwoTierReview()`'s own boundary cases (empty list, mixed
   histology+cytology parts, unknown specimen types).
3. `cytology-two-tier.e2e-spec.ts` — all three ACs (§7), plus: a histology case's own `finalize()`
   path proven completely unchanged (reusing `case-sign-out.e2e-spec.ts`'s own fixture shape,
   confirming no `screen()` step is required or accepted for a non-cytology case), `screen()`
   rejecting an incomplete lineage (reused check), `screen()` rejecting a case already past
   `pending_review`.
4. Re-run `case-sign-out.e2e-spec.ts` and `cytology-pap.e2e-spec.ts` unmodified as a direct
   regression check on `finalize()`'s own behavior for cases that don't require two-tier review.
5. Full local verification: fresh db-reset → new files in isolation → one final fresh-reset +
   full-suite run, this session's own established discipline.
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

The `finalize()` precondition change and the `ck_case_status` CHECK-constraint swap are the only
modifications to existing, already-shipped behavior — both are provably no-ops for any case that
doesn't require two-tier review (i.e., every case created before this feature). Reverting the PR
restores the exact prior constraint and removes the new precondition/routes; no data migration is
needed since `'pending_review'` is additive to the value set, never a value any pre-existing row
would have held.

## 10. Questions requiring human approval

1. **Two-tier requirement derived from a fixed, in-code specimen-type list** (Recommended, §5) —
   not a new `case` column or tenant-configurable metadata (deferred to issue #552) — versus adding
   a real tenant-configuration mechanism now, ahead of #552's own scope.
2. **`screen()` requires no step-up** (Recommended, §5) — matching ADR-0051's own scoping to the
   actual diagnostic release only — versus requiring step-up for screening too, treating every
   tier transition as equally high-stakes.
3. **No new Task-record mechanism; `GET v1/cases?status=...` (a live query) satisfies AC #3**
   (Recommended, §3/§5, matching KB-26's own worklist-vs-task classification) — versus building a
   real `task` table/lifecycle now, a materially larger scope this issue's own estimate doesn't
   cover.
4. **`GET v1/cases`'s default (no `status` filter) excludes terminal states** (`signed_out`/
   `amended`), matching `WorklistController`'s own `ACTIVE_STATUSES` precedent (Recommended) —
   versus returning every case regardless of status by default.

**Do not begin implementation until Status above is changed to APPROVED.**
