# Implementation Proposal: FEAT-052 Culture workflow & reflex cascade
Status: APPROVED
ADR: adr-0046 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-052 (#502)

**Approved 2026-08-11** via the native options-prompt: all three §10 questions accepted as
drafted (ADR-0046's detector-not-timer design, the single-read v1 scope cut, and LOINC 634-6 for
the "Organism identified" analyte).

## 1. Goal
Model the multi-day, iterative, preliminary-by-default culture process (`setup → incubation
(timed) → growth reads → organism ID`) as a metadata-driven reflex cascade, reusing existing
mechanisms end to end rather than building new ones.

**Central finding, surfaced before any design choice (ADR-0046):** KB-21/KB-25 both describe this
in terms of "durable timers" — read literally, a new scheduled-autonomous-action primitive. That
primitive doesn't exist in this codebase and this feature doesn't actually need it. What already
exists, proven twice (`CriticalNotificationEscalationService`, FEAT-021;
`SlaBreachDetectorService`, FEAT-029 remainder), is a narrower, already-correct pattern: an
`@Interval`-polled detector service that surfaces overdue work onto a worklist. A culture read
can't be performed autonomously anyway — a human has to look at the plate — so "the engine
schedules the next read" really means "the engine makes the due read visible," exactly what the
existing pattern already does for SLA breaches. ADR-0046 makes this the feature's own design,
not KB-25's fuller (and here, un-needed) timer vision.

**Second finding:** an isolate does not need a new entity. KB-21 itself says "organisms are coded
Observations" — `observation.dataType = 'coded'`, `analyteId` pointing at a new, single
"Organism identified" analyte, `valueCode` holding the organism's own SNOMED code (a plain `text`
column, not FK'd to a specific coding table — confirmed by reading `observation.ts` directly).
Colony count is the same story with a second new analyte (`quantity` or `ordinal`). Zero schema
change to `observation` itself.

## 2. Affected files
- `db/migrations/00XX_culture_workflow.sql` (new) — `culture_read` table (tenant-scoped, RLS): `id`,
  `tenantId`, `orderedTestId`, `scheduledAt`, `completedAt` (nullable), `result`
  (`'no_growth' | 'growth'`, nullable), `recordedBy` (nullable, no user table yet — same precedent
  `observation.operatorUserId` already established). Also inserts two new global `analyte` rows
  (via this migration or a seed file — TBD in §10): "Organism identified" (coded) and "Colony
  count" (quantity/ordinal).
- `apps/api/src/culture-read/` (new module) — `CultureReadDueDetectorService` (`@Interval`-polled,
  structurally identical to `SlaBreachDetectorService`: `lis_scheduler` cheap enumeration, `lis_app`
  real per-tenant detect-and-write, idempotent, audited, emits a `CultureReadDue` outbox event) and
  `POST /v1/culture-reads/:id/record` (the human action recording a read's result).
- `apps/api/src/reflex/` — extends the existing `AddReflexTest` command handler's own call sites
  (not its own logic) so a `'growth'` result recorded via the new endpoint creates the next-step
  organism-ID `ordered_test`, reusing `parent_ordered_test_id` lineage and
  `reflex-guardrails.ts`'s existing cycle/depth-bound checks verbatim.
- `apps/web/app/(app)/culture-reads/` (new) — a "Cultures due for reading" worklist (a live query
  over `culture_read` where `scheduledAt <= now() AND completedAt IS NULL`, mirroring the existing
  worklist's own query-driven shape, FEAT-017/022) and the read-recording action.
- `packages/domain/src/culture-read.ts` (new) — Zod schemas + response DTOs, matching
  `packages/domain/src/catalog.ts`'s established pattern.

## 3. Architecture consulted
- KB-21 Microbiology, KB-25 Workflow Engine, KB-26 Task Management.
- ADR-0046 — the detector-not-timer decision this proposal's own design follows.
- `engineering/workflow-engine` Skill — entry #5 (`parent_ordered_test_id` self-FK lineage, the
  exact mechanism this feature's own reflex step reuses), entry #6 (reflex always acts on the
  existing specimen — matches microbiology's own single-specimen-across-days model, no gap here),
  entry #4 (a command handler's "cannot safely act" cases are logged no-ops, never thrown — applies
  directly to the new reflex call site this feature adds).
- `domain/specimen-lifecycle` Skill — entry #6 (custody-event tracking is deliberately out of
  scope through the current specimen model) confirms this feature doesn't need to touch specimen
  custody tracking to model "the same specimen sits in an incubator for N days."
- `apps/api/src/sla/sla-breach-detector.service.ts` — read in full, the direct implementation
  precedent for `CultureReadDueDetectorService`.
- `packages/db/src/schema/observation.ts`, `order.ts` — read in full; `ordered_test.status`
  already includes `'in_process'` (no schema change needed there), `observation.valueCode` is
  plain text (no schema change needed for isolates).

## 4. Skills loaded
- `engineering/workflow-engine` (reflex lineage, handler-failure-mode conventions).
- `domain/specimen-lifecycle` (confirms no specimen-model gap for multi-day incubation).
- `engineering/database-design` (migration/RLS conventions for the new `culture_read` table).

## 5. Assumptions & autonomous decisions
- **ADR-0046's detector-not-timer design** — flagged as §10 Q1, since it's a real architectural
  choice, not an obvious one from the KB docs alone.
- **Isolates and colony counts are Observations against two new global analytes, not new
  entities** — not treated as a separately-flagged question; this follows directly from KB-21's
  own explicit "organisms are coded Observations" statement plus the confirmed schema shape, the
  same confidence level FEAT-004's own proposal had for reusing `code_system_value`.
- **v1 supports exactly one scheduled read per culture** (no open-ended multi-day read loop yet —
  a `'no_growth'` result is terminal for v1, not itself creating a second `culture_read` row) —
  flagged as §10 Q2, a real scope cut that narrows KB-21's own fuller "days, iterative" framing.
- **No new capability/role** — reuses whatever capability already gates result-entry-adjacent
  actions (TBD exact name during implementation — likely `enter_result`, not a new microbiology-
  specific one, unless FEAT-051/052's own review surfaces a real reason to differ).

## 6. Risks
- **A second, open-ended read cycle (day 2, day 3...) is real, common lab practice** KB-21 itself
  describes ("proceeds... often reporting preliminary → final across several days") — v1's
  single-read scope (§5) is a genuine narrowing, not a KB-consistent minimal slice; flagged
  explicitly rather than silently assumed sufficient.
- **The "Organism identified" analyte's own dataType/coding shape must be decided once, correctly**
  — every later feature in this epic (FEAT-053's antibiogram, FEAT-054's report) reads isolates
  through whatever shape this feature ships; getting this wrong is the same "expensive to unwind"
  risk ADR-0004/ADR-0045 already named for their own foundational catalog decisions.
- **This is the third `@Interval`-polled detector service** — ADR-0046 already flags this as a
  real, deliberately-not-yet-taken generalization opportunity; worth a human sanity check that a
  fourth near-identical service doesn't appear before that generalization actually happens.

## 7. Acceptance criteria
- [ ] A culture specimen's incubation read is scheduled by the engine (a `culture_read` row,
      surfaced on a worklist), not a human's memory
- [ ] Growth reflexes organism identification automatically once a human records a `'growth'`
      result — a metadata-shaped reflex, no bespoke code path per step
- [ ] A specimen can carry multiple isolates, each its own coded Observation
- [ ] No autonomous software action ever records a growth/no-growth result

## 8. Testing plan
- Unit: `CultureReadDueDetectorService`'s own detection logic (mirrors
  `sla-breach-detector.service.spec.ts`'s own shape if one exists, or establishes the pattern
  freshly); the reflex call site's own no-op-on-cannot-safely-act branches.
- Integration (real Postgres, `DB_POOL_MAX=1`): a real detector tick surfaces a due read; a real
  `record` call with `result: 'growth'` creates exactly one correctly-linked organism-ID
  `ordered_test`; a `'no_growth'` result creates none (v1 scope).
- RLS isolation test for the new `culture_read` table.
- Manual test performed as the real user role (recording a culture read via the worklist UI).

## 9. Rollback plan
Additive — one new table, one new service, one new endpoint, two new global `analyte` rows, an
extension of an existing reflex call site (not a modification to `AddReflexTest`'s own logic).
Rollback is a down-migration dropping `culture_read` and the two new analyte rows, plus removing
the new module — no existing table or endpoint is altered.

## 10. Questions requiring human approval
1. **Approve ADR-0046** — culture incubation reads modeled as a polling detector + worklist row
   (reusing the `SlaBreachDetectorService` pattern), not a new durable-timer primitive; a read
   result is always a human-recorded action, never autonomous?
2. **Approve the v1 scope cut: exactly one scheduled read per culture**, `'no_growth'` terminal for
   v1 (no open-ended multi-day read loop yet) — with the real gap (day-2/day-3 reads are common
   real practice per KB-21) named explicitly, not silently assumed covered?
3. **"Organism identified" analyte's exact coding** — recommend LOINC 634-6 ("Bacteria identified
   in Specimen by Culture") as the `code_system_value` entry, `dataType: 'coded'`, `valueCode`
   holding the organism's own SNOMED code from FEAT-051's catalog. Approve, or is there a
   design-partner preference for a different LOINC code or coding approach?
