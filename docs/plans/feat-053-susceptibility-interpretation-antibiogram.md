# Implementation Proposal: FEAT-053 Susceptibility interpretation & antibiogram
Status: APPROVED (speculative — see §10 Q1)
ADR: none needed (see §3's own resolution of the table-field-type question)    Date: 2026-08-11    Backlog ID: FEAT-053 (#503)

**Approved 2026-08-11** via the native options-prompt: all three §10 questions accepted as drafted,
including explicitly proceeding on FEAT-051's own still-provisional schema (§10 Q1) — this
proposal's §2/§5 may need real revision once FEAT-051's actual implementation lands with real
breakpoint data. **Implementation cannot begin until FEAT-051 is actually built** (a hard technical
dependency, not just a sequencing preference) — this approval unblocks the design, not the code.

## 1. Goal
Interpret a technologist-entered MIC value against the versioned breakpoint table in force at
result time (MIC → S/I/R), and capture the antibiogram as a **dual-emission** result per KB-21's
own explicit design: a `table` Observation (organism × antibiotic grid, the readable report
artifact) *plus* one discrete coded S/I/R Observation per organism–antibiotic cell (the queryable
dataset KB-44's own AMR-surveillance use case depends on — no warehouse/CDC/dashboard work in this
feature's own scope; only producing atoms *shaped* to feed one later, per issue #503's own framing).

**This proposal is unusually speculative and says so up front.** FEAT-051 (organism & breakpoint
catalog) is this feature's own hard, load-bearing dependency — not adjacent context like FEAT-052's
own relationship to FEAT-051, but a literal read: this feature's interpretation service queries
`breakpoint_table`/`breakpoint` directly. FEAT-051 has not been implemented (blocked on real
EUCAST/CLSI data, §10 Q3 of its own proposal), and its own §6 risk explicitly warns its schema "may
not survive contact with a real EUCAST/CLSI table." Everything below designs against FEAT-051's
*proposal-level* schema, not a real, implemented one — §10 Q1 asks explicitly whether to approve on
that basis now or wait.

## 2. Affected files
- `packages/db/src/schema/microbiology-catalog.ts` (extends FEAT-051's own file, once it exists) —
  adds `analyteId` (nullable FK → `analyte`) to `antimicrobial`. Anticipated by FEAT-051's own
  proposal (§5: "antimicrobials will each need their own discipline-specific attributes later") —
  not a new architectural decision, the attribute this feature needs.
- `db/migrations/00XX_antibiogram.sql` (new) — the `antimicrobial.analyteId` column only. No new
  results table — an antibiogram result is `observation` rows (dual-emission, §5), reusing the
  existing substrate, the same discipline every other discipline in this codebase already follows
  (Constitution: Observations are the one clinical-value store).
- `packages/db/src/breakpoint-resolution.ts` (new) — `resolveBreakpoint()` (pure) +
  `resolveSusceptibility()` (DB wrapper), mirroring `reference-range.ts`'s own
  candidates-in/resolved-out shape and effective-dating, structurally simpler (exact
  organism+antimicrobial+method match, no multi-dimensional specificity scoring — FEAT-051's own
  v1 scope excludes organism-group generalization).
- `packages/domain/src/antibiogram.ts` (new) — Zod schemas: raw MIC-entry input (per
  antimicrobial), the dual-emission response shape.
- `apps/api/src/antibiogram/` (new module) — `POST
  /v1/ordered-tests/:orderedTestId/antibiogram`: a technologist enters real MIC values per
  antimicrobial; the handler resolves each against `resolveSusceptibility()` and writes both the
  `table` Observation and each discrete coded Observation in one transaction. Always human-
  initiated (a human enters the raw MIC; the S/I/R math is deterministic computation over that
  human-entered value, the same class `computeFlags()` already is for chemistry results — not an
  autonomous clinical judgment).
- `apps/web/(app)/...` antibiogram entry UI — deferred to implementation; a Google Stitch prompt is
  explicitly TBD per issue #503 itself, since this is likely new UI shape (a grid, not the existing
  single-analyte result-entry form).

## 3. Architecture consulted
- KB-21 Microbiology — the antibiogram's own explicit dual-emission requirement.
- KB-44 Analytics — read in full. Describes a full CDC-to-warehouse analytics pipeline that does
  **not exist anywhere in this codebase** and is explicitly out of this feature's own scope (issue
  #503's own text already narrows this: "the dashboards themselves are out of this feature's own
  scope, but the atom shape must support them"). This feature's only KB-44-relevant job is
  producing correctly-shaped discrete atoms — no pipeline, no warehouse, nothing new to build here.
- `domain/reference-ranges` Skill — the versioned/effective-dated/snapshot precedent
  `resolveBreakpoint()` adapts, and entries #9-10's own warning (real published tables have
  non-obvious shape surprises) — the same warning FEAT-051's own §6 risk already carries forward.
- `engineering/database-design`, `engineering/testing` Skills.
- `packages/db/src/reference-range.ts` — read in full, the direct implementation precedent for
  `resolveBreakpoint()`'s shape (pure resolver + DB-fetching wrapper, `{matched:true,...} |
  {matched:false}`, never fabricates a match).
- `packages/domain/src/report-template.ts` — read in full to resolve issue #503's own explicitly
  flagged open question. **Finding: FEAT-032's `table` template-field type and this feature's
  `table` Observation `dataType` are unrelated mechanisms that happen to share an English word.**
  The former is a report-*layout* instruction (`report_template_version.definition`, "which
  analytes to list"); the latter is a result-*value-storage* kind (`observation.dataType`,
  KB-14's ten value kinds, stored in `valueJson`). No compatibility question exists — resolved as a
  naming coincidence, not a design decision needing an ADR.

## 4. Skills loaded
- `domain/reference-ranges` (versioned-table/snapshot precedent).
- `engineering/database-design`.
- `engineering/testing`.

## 5. Assumptions & autonomous decisions
- **Dual emission via two independent Observation writes in one transaction, not a new results
  table** — not treated as an open question; this is the Constitution's own "Observations are the
  substrate" discipline applied directly, the same pattern FEAT-052's isolate-as-coded-Observation
  already established for this same epic.
- **Each antimicrobial gets its own `analyte` (via a new `antimicrobial.analyteId` FK), not one
  shared "susceptibility" analyte with the drug identified in `valueJson`** — flagged as §10 Q2:
  this makes each antibiotic's own S/I/R result independently queryable via the normal
  `observation.analyteId` join every other discipline already uses (real value, matches AC #2's own
  "carbapenem-resistant E. coli this quarter" example directly), but means seeding one real LOINC
  code per antimicrobial the real breakpoint data ends up covering — deferred to whenever FEAT-051's
  real data determines that list, not invented independently here (same "no fabricated coding
  data" discipline as the clinical values themselves).
- **Breakpoint resolution keys on exact (organismId, antimicrobialId, method) + effective-dating,
  no specificity scoring** — reuses FEAT-051's own v1 scope decision (no organism-group
  generalization) rather than re-deciding it.
- **Recording an antibiogram result is a single all-at-once human action** (enter every
  antimicrobial's MIC for this isolate, submit once), not one API call per antimicrobial — matches
  how a real bench workflow actually works (one susceptibility panel run per isolate) and keeps the
  dual-emission write atomic and simple.

## 6. Risks
- **FEAT-051's own schema is explicitly provisional** (its own §6: "may not survive contact with a
  real EUCAST/CLSI table") — everything in this proposal designs against that provisional shape.
  If FEAT-051's real schema changes materially once real data lands, this proposal's own §2/§5 may
  need real revision before implementation, not just a mechanical adjustment. Named explicitly in
  §10 Q1 rather than assumed away.
- **The per-antimicrobial-analyte LOINC seeding (§5) could grow large** — a real antibiogram panel
  commonly covers 10-20+ antibiotics; picking that many real LOINC codes "in good faith, not
  verified against a live server" (this codebase's own established practice, e.g.
  chemistry-catalog.sql's CMP) carries more real error surface at that volume than the 2-4-analyte
  precedents already shipped (TSH/FT4, Lipid Panel). Mitigated by the same fact that resolves it:
  the real antimicrobial list is downstream of the user's own real breakpoint-data supply, not
  independently invented — whatever antimicrobials that data covers is exactly the list this
  feature needs codes for, no more.
- **No design-partner review of the antibiogram grid's own UI shape yet** — issue #503's own Google
  Stitch prompt is explicitly TBD; this proposal doesn't attempt to design that UI in detail.

## 7. Acceptance criteria
(unchanged from issue #503, restated for traceability)
- [ ] Every organism–antibiotic result is interpreted (MIC → S/I/R) against the breakpoint table in
      force at result time, snapshotted onto the result
- [ ] The antibiogram renders as a real grid **and** is independently queryable as discrete atoms

## 8. Testing plan
- Unit: `resolveBreakpoint()` covered directly (mirrors `reference-range.spec.ts`'s own shape) —
  exact-match resolution, effective-dating, no-match returns `{matched:false}` rather than a
  fabricated interpretation.
- Integration (real Postgres): real organism + antimicrobial + breakpoint fixtures (from FEAT-051's
  own real, cited data once it exists), a real MIC entry resolves to the correct S/I/R, both
  Observations land in one transaction, a later breakpoint-table update does not change an
  already-resolved result's own snapshot (mirrors reference-range's own snapshot-immutability
  proof).
- Golden-dataset validation: blocked on the same real data FEAT-051 itself is blocked on.

## 9. Rollback plan
Additive: one nullable FK column on `antimicrobial`, one new resolver module, one new API module.
No existing table or endpoint is altered. Rollback is dropping the column and removing the new
module.

## 10. Questions requiring human approval
1. **This proposal designs against FEAT-051's own still-provisional schema** (not yet implemented,
   and its own §6 risk says the schema itself may change once real breakpoint data lands). Approve
   proceeding with this design now — understanding FEAT-053's own §2/§5 may need real revision once
   FEAT-051's actual implementation lands — or hold FEAT-053's approval until FEAT-051 is fully
   built and its real schema is known?
2. **Each antimicrobial gets its own dedicated `analyte`** (via a new `antimicrobial.analyteId`
   FK), making per-drug S/I/R results independently queryable the normal way — approve, with the
   real LOINC-per-antimicrobial seeding explicitly deferred to whenever FEAT-051's real breakpoint
   data determines the actual antimicrobial list (not invented now)?
3. **Recording an antibiogram is one all-at-once human action** (every antimicrobial's MIC entered
   together, one submit) rather than incremental per-antimicrobial entry — approve as the v1 shape?
