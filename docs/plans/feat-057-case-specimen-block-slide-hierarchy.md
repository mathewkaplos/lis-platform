# Implementation Proposal: FEAT-057 Case/Specimen/Block/Slide hierarchy & accessioning
Status: APPROVED
ADR: adr-0049 (accepted)    Date: 2026-08-12    Backlog ID: FEAT-057 (#538)

**Approved 2026-08-12** via the native options-prompt — all four §10 questions answered with the
recommended option as drafted: (1) defer `report.ts` Case-awareness to FEAT-058/059, (2) Case is
the real accessioning event, Specimen/part/Block/Slide get derived suffix codes, (3) no new
`order.orderType` discriminator column, (4) 1:1 Case:Order cardinality, enforced.

## 1. Goal
Introduce `Case` as a first-class aggregate above Order/Specimen (ADR-0049), with the physical
hierarchy `Case → Specimen/part → Block → Slide`, each level independently identified and
queryable in one join. This is the foundational feature of EPIC-012/M13 — FEAT-058 (synoptic
protocol engine), FEAT-059 (sign-out), FEAT-060 (reflex stains/IHC), and all four cytology
features read what this feature ships, the same role FEAT-051 played opening M11. Data model +
accessioning API only, matching FEAT-051's own "engine before designer" precedent — no new UI.

## 2. Affected files
- `db/migrations/00XX_anatomic_pathology_hierarchy.sql` (new) — `case`, `block`, `slide`,
  `block_fulfillment` tables (all tenant-scoped, RLS from creation per Constitution Law #4); one
  `ALTER TABLE specimen ADD COLUMN case_id` (nullable — non-AP specimens have none).
- `packages/db/src/schema/anatomic-pathology.ts` (new) — Drizzle schema for the four new tables,
  mirroring `specimen.ts`'s exact shape/comment conventions (text+CHECK status, own tenant_id +
  RLS per join table).
- `packages/db/src/schema/specimen.ts` (edit) — add `caseId` column + index.
- `packages/db/src/schema/index.ts` (edit) — export the new schema module.
- `packages/domain/src/anatomic-pathology.ts` (new) — Zod schemas + response DTOs
  (`CaseCreateSchema`, `CaseSchema`, `BlockCreateSchema`, `SlideCreateSchema`, lineage response),
  matching `packages/domain/src/patient.ts`'s established schema+DTO pairing (api-design #1).
- `apps/api/src/case/` (new module) — `case.controller.ts`, `case.module.ts`:
  - `POST /v1/cases` — accession a case: creates one `case` row + N `specimen`/part rows in one
    transaction, mirroring `specimen.controller.ts`'s existing "one combined create action" shape
    (specimen-lifecycle #1/#2).
  - `POST /v1/cases/:id/blocks` — add a block to an existing part.
  - `POST /v1/blocks/:id/slides` — add a slide to an existing block.
  - `POST /v1/blocks/:id/ordered-tests` — link an existing/new `orderedTest` to a block via
    `block_fulfillment` (the mechanism reflex/add-on stains attach through — AC #4).
  - `GET /v1/cases/:id` — full lineage (case → part → block → slide) in one query.
  - `POST /v1/cases/:id/finalize` — case-level status transition only (see §5 scope cut); does
    **not** generate a report.
- `packages/db/src/rls-isolation-check.ts` (edit) — fixtures for all four new tables. **This file
  has already had two real, separate missing-fixture incidents this milestone (#430, closed via
  PR #535/#536, this session's own breadcrumb) — treat adding all four fixtures as a required
  step, not an afterthought, and verify via `pnpm --filter @lis/db rls-check`, not by inspection.**
- `apps/api/test/case.e2e-spec.ts` (new) — covers AC #1–4 below.

## 3. Architecture consulted
- ADR-0049 (accepted) — the binding decision this proposal implements.
- KB-17 Histology, KB-23 Specimen Tracking, KB-24 Barcoding — physical hierarchy, custody-tracking
  scope, and identifier/symbology conventions.
- `packages/db/src/schema/specimen.ts`, `order.ts`, `report.ts`, `test-catalog.ts` — read in full,
  the direct shape precedent for every new table.
- `packages/db/src/accession.ts` — the existing `generateAccessionNumber()` global-sequence
  mechanism (TASK-045, api-design #13), reused rather than re-derived.
- `docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md` — structural precedent for a
  foundational, API-only "engine before designer" feature opening a new discipline.

**A real discrepancy found while reading the actual schema against ADR-0049's own text:**
ADR-0049 §Decision 1 says `caseId` is added "alongside [specimen's] existing `orderId`/
`orderedTestId` links" — but `specimen.ts` has **no such columns**. Specimen's only link to
Order/OrderedTest today is the `specimen_fulfillment` join table (many-to-many to
`ordered_test`). This proposal adds `caseId` alongside that real existing link (the join table),
not the literal `orderId`/`orderedTestId` columns the ADR's prose describes — the ADR's binding
*decision* (Case is first-class, Specimen gets a `caseId`) is unaffected, only its illustrative
wording was imprecise. Not re-litigating the ADR for this; noting it so the next reader isn't
confused by the mismatch (database-design Skill entry #3's own discipline, applied here).

## 4. Skills loaded
- `engineering/database-design` — discriminator-column convention (#1), forward-reference
  pattern (#2, not needed here — `order`/`specimen`/`test_definition` already exist), RLS-exempt
  marker (#16, not applicable — all four new tables are tenant-scoped, not global).
- `domain/specimen-lifecycle` — accessioning-at-receipt precedent (#1), "one combined create
  action" precedent (#2), specimen<->OrderedTest many-to-many via join table (#3) — the exact
  shape `block_fulfillment` mirrors — and confirmation that full KB-23 custody-event tracking is
  still out of scope repo-wide (#6), so Block/Slide get a simple status field, not a custody log.
- `engineering/rls-multi-tenancy` — join tables need their own `tenant_id` + policy (#2), required
  for `block_fulfillment`; a green Constitution Gate is a starting signal, not proof (#3) — the
  new tables' RLS will be verified live via `rls-isolation-check.ts`, not just a green CI gate.
- `engineering/api-design` — required per the `plan` Skill's own rule (adds new `apps/api`
  routes): Zod-schema-drives-everything (#1), audit/capability ordering (#5), reads not audited
  (#6), 404-not-403 on cross-tenant (#7), explicit `ZodValidationPipe` (#8), retry-vs-sequence
  identifier generation (#9/#13), audited-route return shape (#15).
- `engineering/barcode-printing` — not required for this feature's own scope (no label-rendering
  work here), but block/slide `code` values are designed to be renderable by the existing
  `bwip-js` pipeline (TASK-046) without new work, once a later feature wires the print UI.

## 5. Assumptions & autonomous decisions
- **Case draws from the existing `accession_number_seq`** (`generateAccessionNumber()`,
  unchanged) — no new sequence. A Case is the real accessioning event for AP, matching ADR-0049's
  "created at accessioning."
- **Specimen/part rows under a Case do not call `generateAccessionNumber()` a second time.**
  Their (still `NOT NULL`, still per-tenant-unique) `accession_number` is derived instead:
  `{case.accessionNumber}-P{n}` (part sequence within the case, 1-indexed). This satisfies the
  existing constraint without consuming a second global-sequence value per part, and makes the
  Case unambiguously the one real accessioning event — non-AP specimens are entirely unaffected,
  they keep calling `generateAccessionNumber()` independently exactly as today.
- **Block/slide codes are case-scoped, not part-scoped, for a shorter physical barcode:**
  `block.code = {case.accessionNumber}-B{n}` (block sequence *within the whole case*, not reset
  per part), `slide.code = {block.code}-S{n}`. KB-24 itself describes the encoded relationship as
  "case → block → slide" (not case → part → block → slide) — read as intentional, since 2D
  Data Matrix surfaces (slides) are explicitly space-constrained (KB-24 §Architecture).
  `block.blockNumber`/`slide.slideNumber` are computed as `count(*) + 1` within the same insert
  transaction (max-plus-one, not a sequence) — accepted as low-concurrency-safe per api-design
  #9's own "human-initiated, low-frequency" reasoning: one pathologist grosses one case at a time.
- **No `order.orderType`/discipline discriminator column added.** The existence of a `case` row
  FK'd to an `order` is itself the signal that an order is an AP case — avoids a speculative enum
  column with only one real value so far (matches this repo's own YAGNI convention, database-design
  #1's framing of when *not* to add a discriminator).
- **`case.orderId` is 1:1** (`ux_case_tenant_order` unique on `(tenant_id, order_id)`) — a lab
  needing two independent surgical cases creates two orders. Simpler than modeling
  order-to-multiple-cases for a v1 with no known real need for it yet.
- **Block/Slide `status` is a minimal two-value field (`active`/`disposed`)**, not a
  grossing/processing/staining state machine — KB-17's fuller workflow
  (grossing → processing → sectioning → staining → sign-out) is owned by the workflow engine
  (KB-25) in later M13 features (FEAT-059/060), not this one. This feature only proves the
  hierarchy and identifiers exist and are traceable.
- **`Case.status`**: `accessioned` (default) → `in_process` → `signed_out` → `amended`,
  CHECK-constrained text, matching `specimen.status`'s own convention exactly (plain `text` + a
  `CHECK`, not a native `ENUM` — value count is 4, well under database-design #1's "8+ values on a
  central table" threshold for switching to `ENUM`).

**Scope cut requiring explicit approval (§10 Q1):** FEAT-057's own AC #3 ("a single
report-finalize action covers every part/block/slide under one case") is satisfied at the
*schema-and-query* level only — `POST /v1/cases/:id/finalize` transitions `case.status` to
`signed_out` after confirming every block/slide under the case exists and is `active`, proven by
an e2e fixture with a multi-part case. It does **not** touch `report.ts` (still keyed on
`ordered_test_id`), does not generate a synoptic dataset, and does not implement ADR-0049
§Decision 3's "report is keyed per-Case" at the report-table level — that is real, acknowledged
future work for FEAT-058 (synoptic content) and FEAT-059 (step-up signature + the actual signed
report), which is where `report.ts` most naturally gains Case-awareness alongside the content it
will actually be signing. Building that now, with no synoptic content or sign-out mechanism yet to
attach it to, would be speculative.

## 6. Risks
- **The report.ts Case-awareness gap (§5 scope cut) is real, not hidden** — ADR-0049's own
  Consequences section already names this cost explicitly ("Worklist, TAT reporting, and any
  cross-discipline reporting... needs a Case-aware branch... scoped as part of FEAT-057/058, not a
  hidden cost discovered later"). This proposal defers the `report.ts` half of that to FEAT-058/059
  rather than doing it now; flagging clearly so it isn't lost between features.
- **Fixture-gap regression risk in `rls-isolation-check.ts`** — this exact file has already needed
  two separate real fixes this milestone (#430/#534/#536) for missing fixtures on unrelated new
  tables. Four new tenant-scoped tables in one migration raises the odds of the same class of miss
  recurring; mitigated by treating it as its own explicit step in §2/§8, not an implicit side
  effect of the migration.
- **Max-plus-one numbering for block/slide sequence numbers** (§5) is not safe under true
  concurrent inserts to the same case/block — accepted as a real, low tradeoff for now (one
  pathologist, one case, sequential grossing) per api-design #9's own precedent for
  human-initiated writes; would need revisiting (e.g. a per-case advisory lock, or a real
  sequence) if a future workflow allows concurrent block/slide creation on the same case.
- **KB-17's fuller AP workflow (grossing/processing/staining state machine, custody-event log) is
  genuinely not built by this feature** — real future work for FEAT-059/060, not an oversight;
  don't assume it exists because the table names suggest it.

## 7. Acceptance criteria
(from issue #538, unchanged)
- [ ] A `Case` can be created with 2+ specimen/parts, each with its own block(s) and slide(s)
- [ ] Full lineage (case → part → block → slide) is queryable in one join
- [ ] A single report-finalize action covers every part/block/slide under one case (proven by an
      e2e fixture with a multi-part case) — per §5, this is `case.status → 'signed_out'` plus the
      lineage-completeness check, not a generated report
- [ ] An IHC/stain reflex creates a new OrderedTest on an existing block without creating a new
      Case or Specimen row — via a new `block_fulfillment` row, reusing FEAT-030's existing
      `AddReflexTest`/`parentOrderedTestId` reflex-lineage mechanism unchanged

## 8. Testing plan
- Unit: block/slide code-generation (`{case}-B{n}`, `{block}-S{n}`) and part accession-number
  derivation (`{case}-P{n}`), including the max-plus-one sequencing within a transaction.
- Integration: real Postgres — create a case with 2 parts, each with 2 blocks, each with 2 slides;
  confirm the full lineage query returns the correct 2×2×2 tree in one join.
- RLS isolation: `case`, `block`, `slide`, `block_fulfillment` added to
  `rls-isolation-check.ts`'s structural sweep + live leak check (rls-multi-tenancy #4) — run
  `pnpm --filter @lis/db rls-check` after `pnpm db:reset` and confirm all four pass both checks,
  not just a green Constitution Gate (rls-multi-tenancy #3).
- e2e: `POST /v1/cases` (multi-part), `POST /v1/blocks/:id/slides`,
  `POST /v1/blocks/:id/ordered-tests` (reflex-shaped, mirroring FEAT-052's own reflex-cascade test
  shape per ADR-0049's acceptance criteria), `GET /v1/cases/:id` lineage, `POST
  /v1/cases/:id/finalize` (reject if any block/slide missing or disposed).
- Cross-tenant: a `GET /v1/cases/:id` for another tenant's case returns 404 (api-design #7).

## 9. Rollback plan
Purely additive — four new tables, one nullable column added to `specimen`. No production tenant
data references these tables yet (foundational feature of a brand-new discipline). Rollback is a
down-migration dropping the four new tables and the `specimen.case_id` column, or a straight
revert of the migration file.

## 10. Questions requiring human approval
1. **Approve the report-keying scope cut (§5)?** FEAT-057's `finalize` action transitions
   `case.status` only and proves lineage completeness; it does not make `report.ts` Case-aware or
   generate a synoptic report — that lands in FEAT-058/059. Alternative: add a nullable
   `report.caseId` column now, even with nothing yet writing to it, so the schema-shape decision
   is made once rather than twice.
2. **Approve the accession-number derivation scheme (§5)?** Case draws from the existing global
   `accession_number_seq`; part/block/slide get derived suffix codes
   (`{case}-P{n}`, `{case}-B{n}`, `{block}-S{n}`) rather than each drawing its own sequence value.
3. **Approve no new `order.orderType` discriminator column** — a `case` row's existence is the
   only signal an order is an AP case, versus adding an explicit discriminator now for future
   discipline-branching logic (worklists, reporting) to key off directly.
4. **Approve 1:1 Case:Order cardinality** (unique per tenant+order), versus allowing multiple
   cases per order from the start.
