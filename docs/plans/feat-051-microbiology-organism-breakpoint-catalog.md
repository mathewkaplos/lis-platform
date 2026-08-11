# Implementation Proposal: FEAT-051 Microbiology organism & breakpoint catalog
Status: APPROVED (blocked on §10 Q3 — real breakpoint data not yet in hand)
ADR: adr-0045 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-051 (#501)

**Approved 2026-08-11** via the native options-prompt (ADR-0045's tenant-scoping decision and the
v1 scope cut both accepted as drafted). §10 Q3 was answered "I'll provide a real EUCAST/CLSI table
or citation" — **implementation should not proceed into the migration/seed-file work until that
real source is actually supplied**; the schema in §2 is explicitly provisional pending it (§6's
own risk), not something to guess at now and revise later.

## 1. Goal
Model organisms (SNOMED-coded) and versioned, effective-dated antimicrobial breakpoint tables
(EUCAST/CLSI) as structured metadata — the substrate `FEAT-052` (culture workflow), `FEAT-053`
(susceptibility interpretation), and `FEAT-054` (culture report) all depend on. Data model + API
only, per EPIC-010's own "engine before designer" sequencing (the same order FEAT-032 → FEAT-047
already established for the template engine).

**Central finding, surfaced before any design choice (ADR-0045):** the tenant-scoping question
this feature must answer — is this reference data global (like `analyte`/`unit`) or tenant-scoped
(like `reference_range`)? — is the exact same question ADR-0004 already answered for M1's own
catalog tables, and the same reasoning applies directly: organism/antimicrobial taxonomies and
published breakpoint standards are identical across every tenant, unlike a lab's own validated
reference ranges. ADR-0045 extends ADR-0004's decision to this new discipline rather than
re-litigating it from scratch.

## 2. Affected files
- `db/migrations/00XX_microbiology_catalog.sql` (new) — `organism`, `antimicrobial`,
  `breakpoint_table`, `breakpoint` tables. All four global (no `tenant_id`, no RLS), per ADR-0045.
- `packages/db/src/schema/microbiology-catalog.ts` (new) — Drizzle schema mirroring the migration,
  matching `packages/db/src/schema/catalog.ts`'s own exact shape for `organism`/`antimicrobial`
  (`id`, `codeSystemValueId` → `code_system_value`, `display`, `createdAt`) and
  `packages/db/src/schema/reference-range.ts`'s own versioned/effective-dated shape for
  `breakpoint_table`/`breakpoint` (adapted: organism/antimicrobial/method keys, not patient
  dimensions — see §5).
- `packages/domain/src/microbiology-catalog.ts` (new) — Zod schemas + response DTOs, matching
  `packages/domain/src/catalog.ts`'s own established pattern (schema + inferred type pairs,
  `xResultSchema`/`XResult` naming).
- `apps/api/src/microbiology-catalog/` (new module) — read endpoints only in this feature's own
  scope (`GET` organism/antimicrobial/breakpoint-table listings); no write/admin UI yet (matches
  FEAT-051's own "data model + API only" framing — seed data ships via a `db/seed/*.sql` file,
  the same mechanism `chemistry-catalog.sql`/`haematology-catalog.sql` already use, not an admin
  form).
- `db/seed/microbiology-catalog.sql` (new) — organism catalog + one real, cited breakpoint table.
  **Blocked on §10 Q3** — see below; this file's own content is the single highest-risk part of
  this proposal.

## 3. Architecture consulted
- KB-21 Microbiology — the destination this feature is the first slice of.
- KB-15 Reference ranges — the versioned/effective-dated/snapshot discipline being reused, and the
  multi-dimensional resolution pattern being *adapted* (not copied) for organism/antimicrobial
  keys instead of patient dimensions.
- ADR-0004 (catalog tenant-scoping) — the direct precedent ADR-0045 extends.
- `domain/reference-ranges` Skill — entries #1–2 (schema already matches KB-15's snapshot shape
  exactly, no gap to design around) and #9–10 (critical thresholds are stored as *paired
  one-sided rows*, a real, non-obvious shape found only by reading the actual golden dataset
  closely) are the strongest signal that breakpoint tables likely have their own real shape
  surprises not visible from the KB doc alone — see §6 risk.
- `engineering/database-design` Skill — entry #1 (discriminator columns: text vs. ENUM — this
  feature's own `breakpoint.interpretation` column, S/I/R, is a candidate; `reference_range.rangeType`'s
  own precedent uses plain `text`, not a Postgres ENUM, for the same reason: adding a value later
  is a data change, not a migration).
- `packages/db/src/schema/catalog.ts`, `reference-range.ts`, `test-catalog.ts` — read in full,
  the direct shape precedent for every new table this feature adds.

## 4. Skills loaded
- `domain/reference-ranges` (versioned-table/snapshot precedent — see §3).
- `engineering/database-design` (discriminator-column, migration-shape conventions).

## 5. Assumptions & autonomous decisions
- **`organism`/`antimicrobial` mirror `analyte`/`unit`'s exact shape** (`id`, `codeSystemValueId`,
  `display`, `createdAt`, global) — not treated as an open question; ADR-0045 already settles the
  tenant-scoping half, and reusing the identical column shape for a structurally identical concept
  needs no separate approval.
- **Breakpoint resolution keys on `(organism, antimicrobial, method)`, not patient dimensions** —
  KB-21 itself frames the antibiogram as organism × antibiotic, never patient-sex/age-dependent;
  `reference_range`'s own sex/age/condition columns have no microbiology analog and are
  deliberately not copied.
- **v1 scope is MIC-based interpretation only, single-organism keying, S/I/R only (no
  susceptible-dose-dependent/SDD, no organism-group generalization, no disk-diffusion
  zone-diameter breakpoints)** — flagged as §10 Q2, since EUCAST tables genuinely have a richer
  real shape (organism groups, SDD, dual MIC/zone columns) this proposal has not independently
  verified against a real published table.
- **No admin UI for authoring organisms/breakpoints in this feature** — seed-file only, matching
  FEAT-032's own "engine before designer" precedent and this repo's own established seed-data
  mechanism.

## 6. Risks
- **The exact breakpoint-row shape may not survive contact with a real EUCAST/CLSI table.**
  `domain/reference-ranges` entries #9–10 found real, non-obvious shape complexity (paired
  one-sided critical rows, inverted low/high semantics) only by reading the actual golden dataset
  closely — the same risk applies here, likely worse, since breakpoint tables are a genuinely more
  complex published standard than a chemistry reference-range file. Mitigate by reading a real
  EUCAST or CLSI table's own published structure before finalizing the migration, not assuming
  the schema sketched in §2 is final.
- **No real, citable breakpoint data exists to seed** (§10 Q3) — this is the same "no fabricated
  clinical data without partner/literature citation" concern TASK-027's own golden dataset already
  established as a hard line for this project; this feature cannot silently invent MIC thresholds
  the way an earlier, less safety-critical feature might placeholder other data.
- **Getting ADR-0045's tenant-scoping decision wrong is expensive to unwind** (the same risk
  ADR-0004 itself named) — `FEAT-052`/`053`/`054` all build directly on this feature's own table
  shape.

## 7. Acceptance criteria
- [ ] A SNOMED-coded organism catalog exists and is queryable
- [ ] One real, cited breakpoint table exists, versioned and effective-dated the same way
      `reference_range` already is
- [ ] A historical result can be interpreted (and snapshotted) against the breakpoints in force
      when it was resulted — re-interpreting under a new table is a versioned, audited action,
      never a silent rewrite

## 8. Testing plan
- Unit: breakpoint resolution logic (organism + antimicrobial + method → applicable breakpoint
  row, effective-dated) covered directly, mirroring `reference-range.ts`'s own unit-test shape.
- Integration: real Postgres — insert a real organism + breakpoint table, resolve a real MIC value
  to S/I/R, confirm a later breakpoint-table update does not change the already-resolved result's
  own snapshot.
- No RLS isolation test needed for these four tables specifically (they carry no `tenant_id`, per
  ADR-0045) — matching FEAT-004's own precedent for `analyte`/`unit`/`code_system_value`.
- Golden-dataset validation: **blocked on §10 Q3** — cannot golden-dataset-validate against real
  clinical breakpoint values until a real, cited source exists.

## 9. Rollback plan
Purely additive — four new tables, no existing schema touched. Rollback is a down-migration
dropping the four tables, or a straight revert of the migration file. No production tenant data
exists that references these tables yet (this is the foundational feature of a brand-new
discipline), so there is no data-loss exposure from rolling back.

## 10. Questions requiring human approval
1. **Approve ADR-0045** — organism/antimicrobial catalogs and breakpoint tables are global
   reference data, no `tenant_id`, extending ADR-0004's own precedent rather than tenant-scoping
   them like `reference_range`?
2. **Approve the v1 scope cut** — MIC-based interpretation only, single-organism keying, S/I/R
   only (no SDD, no organism-group breakpoints, no zone-diameter/disk-diffusion breakpoints) —
   with the explicit caveat that the real EUCAST/CLSI table structure hasn't been independently
   verified yet, and the schema in §2 may need real revision once it is (before this feature is
   considered done, not after)?
3. **Where does real, citable breakpoint data come from?** This project's own standing rule
   (TASK-027, `domain/reference-ranges` entry #4) is that clinically-asserted values are never
   fabricated without a design-partner or literature citation. Options: (a) you provide a real
   EUCAST/CLSI table (or a citation to one) to seed for real; (b) seed a small number of clearly-
   labeled **synthetic, non-clinical** breakpoint values for this feature's own testing purposes
   only (matching `chemistry-catalog.sql`'s own "placeholder, not partner data" framing), with
   real data explicitly deferred to a follow-up issue before this ever reaches a real patient
   result. This is a genuinely blocking question — implementation should not proceed past the
   schema/API layer until it's answered.
