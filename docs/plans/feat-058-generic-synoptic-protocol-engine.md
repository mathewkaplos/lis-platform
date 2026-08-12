# Implementation Proposal: FEAT-058 Generic synoptic-protocol engine (ICCR-sourced, breast + colorectal v1)
Status: APPROVED
ADR: adr-0050 (accepted)    Date: 2026-08-12    Backlog ID: FEAT-058 (#539)

**Approved 2026-08-12** via the native options-prompt — all four §10 questions answered with the
recommended option as drafted: (1) real ICCR content researched this session (Loughrey et al. 2022
for colorectal, ICCR Invasive Carcinoma of the Breast v2.1 for breast — both freely published,
fetched and read in full, cross-checked against the design-partner's own CAP templates), (2) the
four-table shape (`synoptic_protocol_version` as its own table), (3) continued deferral of
`report.caseId` to FEAT-059, (4) `synoptic_element.analyteId` NOT NULL.

## 1. Goal
One generic, global, versioned schema (`synoptic_protocol` → `synoptic_protocol_version` →
`synoptic_element` → `synoptic_element_response_option`) that represents any CAP/ICCR synoptic
cancer-reporting protocol as data, per ADR-0050 — not one bespoke feature per organ site. Recording
a case's responses reuses FEAT-053's dual-emission Observation pattern generically (one `table`-typed
grid Observation + one discrete coded/quantity Observation per element), and conditional/skip logic
between elements reuses FEAT-047's `visibilityCondition`/`evaluateCondition` mechanism unchanged.
Data model + recording API only — no admin/authoring UI in this feature's own scope (issue #539's
own framing: "protocol authoring is a data-entry task against the generic schema in v1").

## 2. Affected files
- `db/migrations/00XX_synoptic_protocol.sql` (new) — `synoptic_protocol`, `synoptic_protocol_version`,
  `synoptic_element`, `synoptic_element_response_option`. All four global (no `tenant_id`, no RLS),
  each `CREATE TABLE` preceded by `-- RLS-exempt per ADR-0050` (database-design Skill entry #16;
  confirmed exact marker syntax against `0040_microbiology_catalog.sql`'s own real migration).
- `packages/db/src/schema/synoptic-protocol.ts` (new) — Drizzle schema mirroring the migration,
  matching `microbiology-catalog.ts`'s exact global-table shape (no `.enableRLS()` call) for the
  catalog-like tables, and `breakpoint_table`'s effective-dated pattern for
  `synoptic_protocol_version`.
- `packages/domain/src/synoptic-protocol.ts` (new) — Zod schemas + response DTOs, reusing
  `conditionNodeSchema`/`ConditionNode` from `packages/domain/src/conditions.ts` unchanged for
  `synoptic_element.visibilityCondition` (api-design #1).
- `apps/api/src/synoptic-protocol/` (new module):
  - `GET /v1/synoptic-protocols` / `GET /v1/synoptic-protocols/:id/versions/:versionId` — read the
    protocol/element/response-option tree (needed by any future recording UI or FEAT-059's sign-out
    flow, even though no UI ships in this feature).
  - `POST /v1/cases/:id/synoptic-responses` — record a case's responses against a protocol version,
    generalizing `antibiogram-assembly.ts`'s dual-emission write path.
- `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts` (new) — the generic dual-emission
  writer, one function for every protocol, parameterized by `synopticProtocolVersionId`
  (ADR-0050 §Decision 4), directly generalizing `assembleAndPersistAntibiogram`.
- `db/seed/synoptic-protocol-breast.sql`, `db/seed/synoptic-protocol-colorectal.sql` (new) — real
  ICCR-transcribed content. **Blocked on §10 Q1** — see below.
- `packages/db/src/rls-isolation-check.ts` — **no new fixtures needed** (all four new tables are
  global/RLS-exempt, same as microbiology-catalog's own four tables, which needed none either —
  confirmed by checking that file's own fixture list has no organism/antimicrobial/breakpoint
  entries).

## 3. Architecture consulted
- ADR-0050 (accepted) — the binding decision this proposal implements.
- KB-17 Histology (mandatory coded synoptic dataset, dual emission, narrative-additive rule).
- KB-16 Laboratory Disciplines (structured-atoms rule — every reportable element is also a discrete
  coded Observation).
- KB-12 Template Engine / KB-13 Report Designer — the field-type catalog and
  `visibilityCondition`/analyte-binding guardrails this feature reuses rather than re-derives.
- `apps/api/src/antibiogram/antibiogram-assembly.ts` (FEAT-053) — read in full; the direct dual-
  emission precedent this feature's own writer generalizes line-for-line (resolve → validate →
  discrete Observations → one grid Observation → one audit event).
- `packages/domain/src/conditions.ts` / `apps/api/src/workflow/workflow-condition-evaluator.ts`
  (FEAT-029/047) — `ConditionNode`/`evaluateCondition`/`findUnallowedFields`, reused verbatim per
  ADR-0050 §Decision 3, exactly as `report-template-guardrails.ts` already reuses them with a
  different allow-list.
- `packages/db/src/schema/microbiology-catalog.ts`, `reference-range.ts`,
  `packages/db/src/schema/report-template.ts` — direct shape precedent for the global catalog
  tables, the effective-dated version table, and the versioned-lifecycle table respectively.
- `docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md` — structural precedent for a
  global-reference-data feature explicitly blocked on real, cited clinical content.

**A real discrepancy found cross-checking ADR-0050's exact wording against issue #539's own table
list** (database-design Skill entry #3's discipline, same class of finding FEAT-057's own proposal
made against ADR-0049): ADR-0050 §Decision 1's prose names three tables, folding `version`/
`effectiveFrom`/`effectiveTo` directly onto `synoptic_protocol` itself — but issue #539 explicitly
lists **four** tables including a separate `synoptic_protocol_version`. This proposal follows the
four-table shape (issue #539, and this section's own design below) because: (a) it matches this
repo's own dominant, repeated precedent for versioned reference/config data (`report_template` /
`report_template_version`) rather than mutating or duplicating protocol identity rows per revision,
and (b) ADR-0050's own §Decision 2 talks about "protocols... each exist as `synoptic_protocol_version`
rows," which only makes sense if that table exists separately. Read as the ADR's Decision-section
prose being an imprecise abbreviation of the real shape, not a conflicting binding decision — not
re-litigating ADR-0050 itself over this.

## 4. Skills loaded
- `engineering/database-design` (required per issue #539) — discriminator-column convention (#1,
  `synoptic_element.dataType`/`requirement` stay plain `text` + CHECK, well under the 8+/central-table
  ENUM threshold), RLS-exempt marker (#16, required for all four new tables).
- `engineering/api-design` (required per issue #539) — Zod-schema-drives-everything (#1), reads not
  audited (#6, the two `GET` routes), audited-route return shape (#15, the record-response route).
- `domain/reference-ranges` — not required per issue #539's own list, but consulted for its
  documented lesson (FEAT-051's proposal citing entries #9-10): a published clinical standard's real
  row shape often has non-obvious complexity not visible from the summary doc alone — the same risk
  this proposal's own §6 names for ICCR content.

## 5. Assumptions & autonomous decisions
- **`synoptic_element.dataType` is scoped to `coded` | `quantity` | `text`** (a strict subset of
  `observation.data_type`'s full 10-value enum) — covers every field shape KB-17's own breast-
  resection example needs (tumour size = quantity, histologic type/grade/margin/ER/PR/HER2 = coded,
  free-text comment = text, non-reportable/additive). Richer types (`boolean`, `structured`) are a
  same-shaped follow-up (new CHECK values on an already-global, RLS-exempt table — no migration-shape
  change), not designed speculatively now.
- **Every `synoptic_element` requires its own dedicated `analyteId`** (`NOT NULL`, FK to the global
  `analyte` table), mirroring `antimicrobial.analyteId`'s real usage in the dual-emission writer —
  unlike `antimicrobial.analyteId` (nullable, since that catalog is seeded incrementally ahead of
  full breakpoint coverage), a synoptic protocol version is authored as one complete, deliberate act
  (issue #539 AC #1: "full Required/Recommended element sets"), so an element with no analyte binding
  to record a structured atom against would defeat KB-17's own "never narrative alone" mandate. Each
  new element's seed data therefore includes creating its own `analyte` catalog row (global, per
  ADR-0004) alongside it, the same one-analyte-per-antimicrobial precedent FEAT-053 already
  established.
- **Responses attach to an existing `orderedTestId`, not a new case-level anchor test.** FEAT-058
  does not introduce automatic OrderedTest creation at case accessioning — `POST
  /v1/cases/:id/synoptic-responses` takes a caller-supplied `orderedTestId` that must belong to the
  case's own order (validated the same way `specimen.controller.ts` validates `orderId`/
  `orderedTestIds` against each other), reusing the existing Order/OrderedTest creation flow
  untouched. This is the same "don't build a mechanism ahead of a proven need" discipline api-design
  #4 already establishes for ETag/Idempotency-Key/pagination.
- **`synoptic_protocol_version.status` mirrors `report_template_version`'s exact 4-value
  `draft`/`in_review`/`published`/`archived` CHECK**, even though no admin UI ships to drive
  `in_review` in this feature (matching that table's own precedent: schema-ready for a future
  approval gate, not built now) — v1 seed data only ever writes `draft`→`published` directly, the
  same real-vs-schema-possible gap `report_template_version`'s own header comment already documents
  for itself.
- **`visibilityCondition` lives as a nullable `jsonb` column directly on `synoptic_element`** (not a
  nested tree inside a single jsonb document the way `report_template_version.definition` is) — this
  schema is relational per-element (each element is its own row, unlike a template's tree-in-one-
  column shape), so the condition attaches to the row it governs directly. The allow-list
  `findUnallowedFields` checks against is that protocol version's own sibling element `key`s,
  computed dynamically at publish time (not a fixed constant like `TEMPLATE_ALLOWED_FIELDS`, since a
  different protocol version has a different valid field set) — a new, protocol-version-scoped
  guardrail function, not a reuse of `report-template-guardrails.ts`'s literal constant.

## 6. Risks
- **Real ICCR protocol content has not been independently verified against a real published dataset
  by this proposal** — the same risk `domain/reference-ranges` entries #9-10 and FEAT-051's own §6
  already named for breakpoint tables, very possibly worse here: ICCR datasets are individual papers,
  not one machine-readable export (ADR-0050's own Context), so the schema in §2 may need real
  revision once actual breast/colorectal element lists are transcribed, not assumed final now.
- **No real, citable protocol content exists to seed yet** (§10 Q1) — the same "never fabricate
  clinically-asserted content without a real citation" line TASK-027/FEAT-051's own §10 Q3 already
  drew for breakpoint data applies with at least as much force here: inventing plausible-looking
  Required/Recommended element lists for a real cancer-reporting standard is a genuine patient-safety
  risk this proposal will not take unilaterally.
- **The case-level report-keying gap FEAT-057's own proposal deferred (its §5/§10 Q1) becomes load-
  bearing here, not just theoretical** — FEAT-058 is the first feature to actually record real
  clinical Observations meant to feed a per-Case report (ADR-0049 §Decision 3). This proposal's own
  §10 Q3 surfaces the question explicitly rather than silently deciding it a second time.
- **`synoptic_element_response_option`'s coded-value shape may not survive contact with a real ICCR
  value list** the same way breakpoint rows didn't (FEAT-051's own real finding) — some ICCR elements
  are free narrative-with-guidance rather than a closed value set; §2's schema assumes every `coded`
  element has a `synoptic_element_response_option` set, which may need a "coded-but-open-ended"
  escape hatch once real content is transcribed.

## 7. Acceptance criteria
(from issue #539, unchanged)
- [ ] Breast and colorectal protocols exist as `synoptic_protocol_version` rows with their full
      Required/Recommended element sets, cross-checked against both the ICCR published dataset and
      the design-partner's own template files, with any discrepancy explicitly reconciled
- [ ] A case's synoptic responses, once recorded, produce both a readable grid Observation and
      discrete coded atoms per element (e2e fixture mirroring `report-assembly.spec.ts`)
- [ ] Adding a third protocol requires zero code changes — only new `synoptic_element` rows
- [ ] Conditional/dependent elements correctly hide/show using the existing `visibilityCondition`
      mechanism

## 8. Testing plan
- Unit: the protocol-version-scoped `visibilityCondition` allow-list guardrail (§5); response-option
  validation for `coded` elements; required-element-present validation, including the case where a
  required element is currently hidden by an unmet `visibilityCondition` (must not be required in
  that state).
- Integration: real Postgres — record a full protocol response set for a multi-element version;
  confirm exactly one `table`-typed grid Observation and N discrete Observations exist, each
  `analyteId`-queryable independently (proving AC #2's "discrete coded atoms" claim directly, not by
  inspection).
- No RLS isolation test needed for the four new tables (global, no `tenant_id`, per ADR-0050) —
  matching FEAT-051/FEAT-004's own identical precedent.
- Golden-dataset validation: **blocked on §10 Q1**, same as FEAT-051's own breakpoint data — cannot
  validate seeded protocol content against a real source until one is supplied.
- e2e: `POST /v1/cases/:id/synoptic-responses` happy path (dual emission), a required-element-missing
  rejection, a `visibilityCondition`-hidden element correctly not required, an `orderedTestId` not
  belonging to the case's order rejected with 400.

## 9. Rollback plan
Purely additive — four new global tables, no existing schema touched (the recording writer only
ever inserts new `observation` rows, the same additive shape every other discipline's writer uses).
Rollback is a down-migration dropping the four tables, or a straight revert of the migration file. No
production case has recorded synoptic responses yet (this is the second feature of a brand-new
discipline), so there is no data-loss exposure from rolling back.

## 10. Questions requiring human approval
1. **Where does real, citable breast + colorectal ICCR protocol content come from?** This project's
   own standing rule (TASK-027, FEAT-051 §10 Q3 precedent) is that clinically-asserted content is
   never fabricated without a real citation. Options: (a) you provide the real ICCR published
   datasets (or point me at them) to transcribe, cross-checked against the design-partner's own
   `BREAST CAP TEMP`/`COLON TEMPLATE` files already in `/mnt/d/LIS/research`; (b) I do the ICCR
   research myself this session (the same kind of real online research ADR-0050 itself was drafted
   from) and present the transcribed element lists for your review before seeding them; (c) seed a
   small number of clearly-labeled **synthetic, non-clinical** elements for this feature's own schema
   testing only, with real content explicitly deferred to a follow-up issue. This is genuinely
   blocking — implementation should not proceed into the seed-file work until answered, though the
   schema/API/recording-writer layers (§2, minus the two seed files) can proceed regardless.
2. **Approve the four-table shape (§3's discrepancy finding)** — `synoptic_protocol` +
   `synoptic_protocol_version` as two tables (matching `report_template`/`report_template_version`),
   over ADR-0050's own shorter three-table Decision-section prose?
3. **Where should the eventual per-Case report actually assemble from, now that real clinical data
   exists to assemble?** FEAT-057 deferred this; this proposal defaults to *still* deferring it to
   FEAT-059 (sign-out is the feature that actually generates the signed report) and scopes FEAT-058
   to recording only. Approve that continued deferral, or should FEAT-058 itself introduce a minimal
   `report.caseId` now that real Observations exist to assemble?
4. **Approve `synoptic_element.analyteId` as `NOT NULL`** (§5) — every element requires its own
   dedicated global `analyte` catalog row authored alongside it, versus a nullable column allowing
   elements with no structured-atom binding yet (which would silently violate KB-17's "never
   narrative alone" rule for that element).
