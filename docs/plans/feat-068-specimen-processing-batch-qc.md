# Implementation Proposal: Specimen-Processing Batch QC (EPIC-013 v1)
Status: APPROVED
ADR: none yet (see §6 Q1 — may need one if the human picks the generic-schema option)    Date: 2026-09-05    Backlog ID: FEAT-068 / EPIC-013 (issue #795)

## 1. Goal

Give the design partner's own currently-paper-only tissue-processing QC workflow a real, structured
home in the platform: fixation, processing, section thickness, tissue folds/tears, staining
quality, coverslipping, and specimen orientation — each a pass/fail judgment made by a pathologist
reviewing a batch of freshly-cut/stained slides — tied to the grossing pathologist and histotech who
produced them, and to the specific accessioned cases the batch covers.

Source document (real, currently in use): `D:\LIS\research\partner documents\TRACKING SHEET
(1).docx` — "IQC FOR TISSUE PROCESSING, MICROTOMY, H/E STAINING & TRACKING SHEET." Its exact layout,
extracted directly from the docx (not assumed or paraphrased):

- Header: **Doctor Trimming** (name), **Histo Tech** (name), **Grossing Date**, **Date of Forwarding
  Slides**.
- **Pathologist Slide Evaluation Criteria** — seven pass/fail judgments, each with its own two named
  states (not a generic yes/no): Tissue fixation (Adequate/Inadequate), Processing
  (optimal/Suboptimal), Thickness of sections (Acceptable/unacceptable), Interfering tissue folds
  and tears (Present/Absent), Staining Quality (Acceptable/Unacceptable), Coverslipping
  (Artefacts/No artefacts), Tissue orientation and complete section (Satisfactory/Unsatisfactory).
- **Comments** (free text) and **Corrective Action where Necessary** (free text).
- A manifest table: **Lab No.** / **No. of Slides** / **Doctor's Remarks**, one row per case covered
  by this batch (the blank template has 28 numbered rows).

## 2. Affected files

- `packages/db/src/schema/specimen-processing-qc.ts` (new) — `specimen_processing_batch` +
  `specimen_processing_batch_case` tables, migration.
- `packages/domain/src/specimen-processing-qc.ts` (new) — Zod schemas for both tables' create
  payloads, the seven-criterion coded value sets, response types.
- `apps/api/src/specimen-processing-qc/` (new module) — `specimen-processing-qc.controller.ts`
  (`POST /v1/specimen-processing-batches`, `GET /v1/specimen-processing-batches`,
  `GET /v1/specimen-processing-batches/:id`), `specimen-processing-qc.module.ts`.
- `apps/api/src/auth/capabilities.ts` — new `record_processing_qc` capability (see §5).
- `apps/web/app/(app)/specimen-processing-qc/` (new) — list screen + a recording form matching the
  paper sheet's own layout (header fields, seven criterion radio-groups, comments, a repeatable
  case-row picker).
- `openapi.json` / `packages/sdk` — regenerated for the three new routes.

## 3. Architecture consulted

- `anatomic-pathology.ts` (`caseTable`, `block`, `slide`, `caseReportVersion`) — the closest existing
  precedent for a tenant-scoped table attributing an action to a user with no `user` table to FK
  against (`signedByUserId`/`signedByRole` convention, reused here for
  `grossingPathologistUserId`/`histoTechUserId`).
- `domain/specimen-lifecycle` Skill entry #5 (rejection reasons are a fixed, coded seven-value list,
  not free text) — the direct precedent for coding each of the seven evaluation criteria as a fixed
  two-value CHECK-constrained column, not a boolean (the sheet's own two named states per criterion,
  e.g. "Adequate"/"Inadequate", are not interchangeable with a generic true/false the way a boolean
  would imply) and not free text (would violate Constitution Invariant #1 if treated as a clinical
  judgment stored as prose).
- `engineering/rls-multi-tenancy` Skill entry #2 — the join table
  (`specimen_processing_batch_case`) gets its own `tenant_id` + RLS policy, not a reliance on its
  parent tables' policies, matching `block_fulfillment`'s own precedent in `anatomic-pathology.ts`.
- `engineering/database-design` Skill entry #1 — seven two-value criteria plus a `status` field are
  all well under the "8+ values on a central table" ENUM threshold; plain `text` + CHECK, matching
  every other status-shaped column in this codebase.
- `engineering/api-design` Skill entries #2/#5/#6/#8/#15 — RFC 9457 errors, audit+capability
  ordering, mutation-only audit scope, explicit-schema validation, and the `{resourceId, before,
  after}` audited-mutation return shape all apply directly to the new `POST` route.
- Constitution Invariant #5 (every clinically significant action is audited) — recording a batch QC
  review documents whether the specimens in it were processed to a standard a diagnosis will be read
  against; this is audited (`@Audit()`), matching `specimen.controller.ts`'s own precedent for
  `receiveSpecimen()`.

## 4. Skills loaded

- `engineering/database-design`, `engineering/rls-multi-tenancy`, `engineering/api-design`,
  `engineering/frontend-design` (new `apps/web` screen/form) — all required per the `plan` Skill's
  own "load regardless of whether the issue names it" rule for any new route/page.
- `domain/specimen-lifecycle` — required: this feature attaches to the existing accessioning/
  specimen model and must not duplicate or conflict with its established conventions (accession
  numbers, coded fixed value sets).
- `engineering/anatomic-pathology-synoptic-engine` — read for precedent, not reused directly: its
  entry #1 ("generic tree-walker only after real evidence proved the shape") is the direct reasoning
  behind this proposal's own recommendation in §6 Q1 to build a concrete v1, not a generic
  cross-discipline QC engine, from a single real document.

## 5. Assumptions & autonomous decisions

1. **Batch-level anchor, not per-specimen or per-block.** The source document evaluates seven
   criteria *once* per batch (one Doctor Trimming, one Histo Tech, one Grossing Date), then lists
   potentially many cases (`Lab No.`) that batch covers, each with its own slide count and remarks.
   Modeled as `specimen_processing_batch` (the shared evaluation) with a child
   `specimen_processing_batch_case` (per-`Lab No.` row: `caseId`, `slideCount`,
   `pathologistRemarks`) — not a row per specimen/block, and not folded into `case`/`block`/`slide`
   themselves.
2. **`Lab No.` maps to `case.accessionNumber`, not `specimen.accessionNumber`.** The sheet is
   specifically about tissue processing/microtomy/H&E staining — i.e., anatomic pathology's own
   block/slide production — and `case` is AP's real top-level accessioned entity (ADR-0049). A
   histology `Lab No.` a pathologist writes on this sheet is the same number printed on the
   specimen container and the eventual report, which in this schema is `case.accessionNumber`.
3. **Grossing/staining lifecycle is captured as a single creation event, not a multi-step workflow.**
   The paper form is filled in progressively (grossing date now, forwarding date later, evaluation
   last) but nothing in this schema needs to model that as separate transitions for v1 — one
   `POST` records the whole completed batch, matching `engineering/api-design` Skill entry #4's
   "defer until a real failure mode needs it" discipline (no evidence yet that a partial/in-progress
   batch needs to be visible mid-workflow).
4. **The seven criteria and their two named states per criterion are fixed, not tenant-configurable**
   for v1 — they're transcribed directly from the one real document evidencing this feature at all;
   no second document or design-partner request has asked for different criteria.
5. **`grossingPathologistUserId` carries no FK** (no `user` table exists in this schema, matching
   `caseReportVersion.signedByUserId`'s own established convention) — resolved from the recording
   user's own JWT `sub` claim server-side, not a form field (whoever is `record_processing_qc`-
   capable and submits the form is the attributed pathologist). **`histoTechName` is a plain
   `text` form field, not a user reference** (per §10 Q2's answer) — no histotech role/roster exists
   in this system yet, and inventing one ahead of real need is out of this proposal's scope.
6. **New capability `record_processing_qc`**, granted to `pathologist` — the sheet is explicitly the
   *pathologist's* own evaluation of already-processed slides, not a technologist/histotech
   self-report. Not folded into `verify` (clinical result sign-out) or `manage_specimens` (specimen
   receipt) — this is neither.

## 6. Risks

1. **The histotech is a named individual on every real batch, but no `histo_tech` role or user
   roster exists in this system yet** (`capabilities.ts`'s own role list has no technologist-
   specialization narrower than `technologist`). Storing a free-text name defeats the "no free text
   for anything with a structured home" instinct this whole feature exists to satisfy, but inventing
   a new roster/role is real, separate scope. See §10 Q2.
2. **This is explicitly scoped to histology/AP in v1** (per §6 Q1's recommended answer) — if the
   human instead wants a genuinely cross-discipline schema now, the whole data model in §2 changes
   shape (criteria become tenant/discipline-configurable metadata, not fixed columns), which is a
   materially larger build, not an incremental change to this same proposal.
3. **No live design-partner sign-off yet that this schema's granularity (batch → case, not batch →
   block/slide) matches how they'd actually want to query it back later** (e.g., "show me every
   batch this specific block was part of" isn't answerable if only the case-level Lab No. is
   captured, not the block). Flagged, not resolved — deferred to real usage feedback per this
   project's own "don't design ahead of real evidence" discipline, matching how the synoptic-
   protocol engine's own generalization was deferred until five real protocols existed.

## 7. Acceptance criteria

- [ ] `POST /v1/specimen-processing-batches` (`record_processing_qc`-gated, `@Audit()`) creates one
  batch header row plus N case rows in one transaction; rejects an empty case list (400).
- [ ] Each of the seven criteria is validated against its own fixed two-value set server-side (a
  malformed value 400s with a real Zod field error).
- [ ] `GET /v1/specimen-processing-batches` lists batches for the tenant (paginated/capped, matching
  every other list route's own established convention), filterable at least by date range.
- [ ] `GET /v1/specimen-processing-batches/:id` returns the batch plus its case rows, each case row
  resolved to enough of `case`'s own data (accession number, patient name) to render without a
  second round trip per row.
- [ ] Cross-tenant access to a batch by ID returns 404 (RLS), not 403 — matching
  `engineering/api-design` Skill entry #7.
- [ ] A `pathologist`-roled user can reach and submit the new recording form; a `technologist`-only
  user cannot (403, rendered as a specific in-form message per issue #768's own established
  pattern, not a generic failure).
- [ ] New `specimen-processing-qc.e2e-spec.ts` covering the above; new `apps/web` Playwright
  coverage for the recording form (following `case-report-email.spec.ts`'s own real-browser
  precedent).

## 8. Testing plan

- `apps/api` e2e: happy path, malformed-criterion 400, empty-case-list 400, cross-tenant 404, RBAC
  403 for a non-`pathologist` role, audit row written with the correct `resourceId`/`actorRole`.
- `apps/web`: real-browser Playwright submission of the recording form as a seeded pathologist
  account, matching this repo's own "real Keycloak login, not a cookie-signing shortcut" harness
  convention.
- `pnpm --filter api typecheck/lint`, `pnpm --filter web typecheck/lint`, full `apps/api` e2e suite
  against a freshly reset local DB.

## 9. Rollback plan

Purely additive: a new schema module, a new capability, a new `apps/web` route. No existing table,
route, or screen is modified. Revert is a plain `git revert` of the merge commit; the new migration
can be rolled back independently since nothing else depends on these tables yet.

## 10. Questions requiring human approval

**Q1 — build a concrete AP-specific v1, or a generic cross-discipline QC engine, given EPIC-013's
own decision that this is cross-cutting but the only real evidence is histology-specific?**
**Answered: concrete AP-specific v1** — fixed schema/columns matching the one real document
exactly, deferring generalization until a second real discipline's QC form surfaces. §2/§5 above
already reflect this.

**Q2 — how should the histotech (no matching role/roster exists) be recorded on a batch?**
**Answered: a free-text name field** — avoids inventing a new role/roster ahead of real need.
`specimen-processing-qc.ts`'s `specimen_processing_batch` table should therefore have
`histoTechName: text("histo_tech_name").notNull()` rather than a `histoTechUserId` FK/no-FK column;
`§2`/`§5` item 5 above is updated by this answer — only `grossingPathologistUserId` (the
capability-gated submitter, resolved server-side) is a real user attribution, not a form field.

Both questions resolved by the human on 2026-09-05. No further approval gate remains except the
overall `Status: APPROVED` change on this document itself, per Rule #0 — implementation does not
start until that happens.
