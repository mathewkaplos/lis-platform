# Implementation Proposal: FEAT-024 — Peripheral film structured reporting

Status: APPROVED
ADR: adr-0025 (accepted)    Date: 2026-08-09    Backlog ID: FEAT-024 (#33)

§10's open questions were resolved by the human via the native options-prompt, all recommended
options chosen: **Q1** one shared grading scale (none/1+/2+/3+) across every morphology analyte.
**Q2** RBC morphology + platelet estimate only, WBC morphology deferred. **Q3** `notes` accepted on
write for the `ordinal` branch only. **Q4** yes, draft an ADR now — see `adr-0025`
(`~/work/lis-engineering/adr/adr-0025-resultentryschema-ordinal-branch-shared-grade-vocabulary-notes-scoped-to-ordinal-only.md`),
drafted alongside this proposal and **accepted 2026-08-09**, same session, alongside this
proposal's own approval.

## 1. Goal

FEAT-024's own literal AC (issue #33): "Morphology findings are captured as graded ordinal controls,
not a free-text field." Its dependency, FEAT-023 (haematology CBC + differential), is merged.
`domain/haematology` Skill entry #3 states this plainly: "Morphology (`ordinal` dataType) is
explicitly out of scope for FEAT-023 — it belongs to FEAT-024... that machinery (structured ordinal +
narrative-inside + image attachment, per KB-19) is real, deliberately deferred work belonging to
FEAT-024's own proposal." This is that proposal.

**Real, load-bearing finding #1 — `'ordinal'` is a real, already-migrated `observation.data_type`
enum value with its own DB check constraint, but has never been reachable through the write API.**
`packages/db/src/schema/observation.ts`'s `observationDataType` pgEnum has carried `'ordinal'` since
the schema's own first migration (`ck_observation_ordinal_value` requires `valueCode IS NOT NULL`
when `dataType = 'ordinal'`) — but `packages/domain/src/observation.ts`'s `resultEntryDataTypeSchema`
(`z.enum(["quantity", "coded", "text"])`) and `resultEntrySchema`'s discriminated union only cover 3
of the 10 real values, by FEAT-014's own deliberate proposal-time decision ("the other 7... are real,
described in KB-14, and genuinely out of scope until a task needs them"). FEAT-024 is the first task
that needs `'ordinal'` — this proposal widens that boundary for the first time, not inventing new
storage.

**Real, load-bearing finding #2 — the read side already carries everything morphology needs;
only the write side and the UI are missing.** `observationSchema` already exposes `valueCode:
z.string().nullable()` (used today by `'coded'` writes) — a morphology grade written as `valueCode`
would already round-trip correctly through every existing read path (`list()`, `prior()`) with zero
schema change there. `observation.notes` (`packages/db/src/schema/observation.ts`) is a real,
already-migrated `text` column — grepped `packages/domain/src`/`apps/api/src` for any reference:
zero hits. It is the exact, already-existing home for KB-19's "narrative field *inside* the
structure," currently 100% dead. Neither of these needs a migration — both need only to be wired
through `resultEntrySchema`/`observationSchema` and the controller's write path.

**Real, load-bearing finding #3 — image/attachment capture has zero supporting infrastructure
anywhere in this repo, not a smaller gap than expected but a total one.** Grepped `packages/db`,
`apps/api`, `packages/domain` for any attachment/S3/blob/presigned-upload code: the only hits are
the bare `'attachment'` enum literal and its own check constraint (`valueJson IS NOT NULL`) —
`packages/db/src/schema/report.ts`'s own comment states plainly "No PDF bytes stored... no
object/blob storage" anywhere in this system yet. Building real image capture (object storage
provisioning, an upload route, a storage client, annotation UI) is a genuinely separate, large
feature, not a corner of this one — **explicitly out of scope for this proposal** (§6 Risks), same
"KB names it, the real narrow slice is what gets built" discipline TASK-062 already established
against Stitch §8.0's own larger Work Queue vision.

**Real, load-bearing finding #4 — `results-grid.tsx`'s parent Server Component filters out every
non-`quantity` analyte before the grid ever sees it, and its own "Result" column is unconditionally
a numeric `<Input>`.** `apps/web/app/(app)/orders/[id]/results/page.tsx:85`: `if (analyte.dataType
!== 'quantity') continue;` — a real, deliberate FEAT-014-era filter ("no real coded/text analyte
exists in the seeded catalog to render either shape against"), now the concrete thing this proposal
removes for `'ordinal'` specifically. `results-grid.tsx`'s own "Result" cell (line ~381) renders
`<Input type="number">` unconditionally for every non-calculated row — a morphology row reaching
this path today would render a broken numeric box, not a graceful fallback.

**Real, load-bearing finding #5 — no peripheral-film test/panel exists in the seeded catalog, and no
reflex/workflow engine exists to auto-order one off an abnormal CBC.** FEAT-023's own seed
(`db/seed/haematology-catalog.sql`) creates exactly one `test_definition` ("CBC"); grepped for
morphology/anisocytosis/poikilocytosis/polychromasia/peripheral film/blood film: zero hits. KB-19's
own "Abnormal CBC with reflex" example names a workflow-engine-driven auto-order this repo doesn't
have yet (confirmed already this session, FEAT-022 research). This proposal seeds Peripheral Film
as its own standalone orderable `test_definition`, mirroring CBC's own precedent — not hooked into
a reflex mechanism that doesn't exist.

## 2. Affected files

New:
- `apps/api/test/peripheral-film.e2e-spec.ts` — real HTTP/Postgres/Keycloak coverage of the new
  ordinal write path.
- `db/golden/peripheral-film-morphology.json` (or a new section of an existing golden mechanism) —
  proves the seeded morphology catalog matches a reviewed fixture, same convention as
  `chemistry-ranges-criticals.json`.

Modified:
- `packages/db/src/schema/observation.ts` — no schema change (column/constraint already real,
  finding #1) — listed for completeness only.
- `packages/domain/src/observation.ts` — new `morphologyGradeSchema = z.enum(["none", "1+", "2+",
  "3+"])`; `resultEntryDataTypeSchema` gains `"ordinal"`; `resultEntrySchema`'s discriminated union
  gains a 4th branch (`{dataType: "ordinal", valueCode: morphologyGradeSchema, notes:
  z.string().max(...).optional()}`); `observationSchema` gains `notes: z.string().nullable()`.
- `apps/api/src/observation/observation.controller.ts` — `upsertObservation`'s `valueFields`
  branching gains a 4th case (`valueCode`/`notes` set when `dataType === 'ordinal'`); `toObservationDto`
  gains `notes`. `resolveRangeAndFlags`'s existing `dataType !== 'quantity'` skip-branch already
  covers `'ordinal'` correctly (empty flags, no range resolution) — no change needed there.
- `db/seed/haematology-catalog.sql` — new "Peripheral Film" `test_definition` + 4 morphology
  analytes (RBC morphology: Anisocytosis, Poikilocytosis, Polychromasia; Platelet Estimate),
  reusing the existing `blood_edta` specimen type — no new specimen type.
- `apps/web/app/(app)/orders/[id]/results/page.tsx` — widen the dataType filter to admit
  `'ordinal'`; thread `initialValueCode`/`initialNotes`/`dataType` into `ResultRow`.
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` — new ordinal branch in the "Result"
  cell: a 4-option graded control (none/1+/2+/3+) plus an optional narrative text input, replacing
  the numeric `<Input>` for this dataType only.
- `apps/api/openapi.json`, `packages/sdk/src/schema.ts` — regenerated (CI-enforced).

## 3. Architecture consulted

KB-19 (Haematology) — "Blood-film morphology is structured, not prose... captured as **ordinal**
Observations... with a narrative field *inside* the structure for nuance and image attachments" —
read in full; images explicitly deferred per finding #3. KB-14 (Result Engine) — the 10-value
`dataType` polymorphism this proposal draws its 4th branch from, and its own "narrative text is
allowed *in addition*, never *instead*" principle, which `notes` (additive to the graded `valueCode`,
never a replacement for it) satisfies directly. `domain/haematology` Skill entry #3 (the direct
predecessor finding this proposal fulfills) and entry #5 (unconstrained `analyte.dataType` — verify
seed values by eye against the enum, no typo). Google Stitch Prompt Library §12.2 (Peripheral Film) —
"structured morphology grading... as ordinal graded controls (none/1+/2+/3+), a narrative field
within the structure... image attachments" — read narrowly per finding #3.

## 4. Skills loaded

`domain/haematology` (entries #3, #5 directly relevant). `engineering/frontend-design` (entry #1:
`StatusPill` reserved for clinical result flags, not applicable to a grade-selector control — a new
segmented-control shape, not a `StatusPill`/`Badge` reuse). `engineering/api-design` (discriminated-
union request-validation convention already established by `resultEntrySchema`'s own 3 existing
branches, extended not replaced).

## 5. Assumptions & autonomous decisions

- Morphology grading vocabulary is a single, shared 4-value scale (`none`/`1+`/`2+`/`3+`) across all
  seeded morphology analytes — matches KB-19's own literal example, avoids inventing a
  per-analyte-varying scale with no real clinical source to justify the variation.
- `notes` is wired through generically on `observationSchema` (read side, all dataTypes) but only
  accepted on write for the `'ordinal'` branch of `resultEntrySchema` in this pass — the narrowest
  change that satisfies KB-19's "narrative inside the structure" for morphology specifically, without
  speculatively opening free-text notes on every other result type this proposal doesn't otherwise
  touch.
- Peripheral Film is seeded as its own standalone `test_definition` (mirroring CBC), orderable
  independently — not gated behind any reflex/auto-order mechanism, none of which exists yet.
- No flagging/critical logic is invented for morphology grades — `resolveRangeAndFlags`'s existing
  `dataType !== 'quantity'` skip-branch already returns `flags: []` for `'ordinal'`, unchanged. KB-19
  itself frames a blast flag or "markedly abnormal count" as what reflexes review, not a graded
  morphology finding on its own — inventing a "3+ always flags" rule would be clinical logic this
  proposal has no real source to justify.
- Reused existing `blood_edta` specimen type for Peripheral Film orders — a peripheral film is made
  from the same draw as CBC; no new specimen type needed.

## 6. Risks

- **Image/attachment capture is real, named-in-KB-19 scope this proposal does not build** (finding
  #3) — a future feature, not a gap silently dropped. Flagged here plainly, same discipline as every
  other "KB names more than this task builds" finding in this repo.
- **WBC morphology (toxic granulation, left shift, blasts, atypical lymphocytes, etc.) is real,
  KB-19-named scope this proposal also does not build** — its own term vocabulary is materially
  larger and more varied than RBC morphology's 3 ICSH-standard gradeable findings, and no design-
  partner data exists to seed it responsibly (same "don't fabricate clinically-asserted values with
  no citation" discipline `clinical-chemistry`/`reference-ranges` already established). v1 scope is
  RBC morphology (Anisocytosis, Poikilocytosis, Polychromasia) + Platelet Estimate only.
- Seeded LOINC codes for the 4 new analytes are good-faith picks, not verified against a live LOINC
  server — same caveat FEAT-014's own eGFR/LDL codes and FEAT-023's own haematology codes already
  carry.
- Widening `resultEntrySchema`'s discriminated union is the first precedent for adding a 4th
  dataType branch — a future task adding a 5th (`boolean`, `datetime`, etc.) should follow this same
  shape, not invent a new extension mechanism.

## 7. Acceptance criteria

- [ ] A morphology analyte's result can only be submitted as one of the 4 graded values
      (`none`/`1+`/`2+`/`3+`) — an arbitrary free-text string is rejected at validation, not stored.
- [ ] An optional narrative note can be attached to a graded morphology result and persists alongside
      the graded value — never as a substitute for it (a note-only, grade-empty submission is
      rejected).
- [ ] The results grid renders a graded control (not a numeric input) for a morphology row, and a
      numeric input unchanged for every existing quantity row — no regression to CBC/chemistry entry.
- [ ] `openapi.json`/`packages/sdk/src/schema.ts` regenerated and committed.
- [ ] Golden-dataset check proves the seeded Peripheral Film catalog (4 analytes, correct dataType)
      matches a reviewed fixture.

## 8. Testing plan

New `apps/api/test/peripheral-film.e2e-spec.ts`: draft/finalize a morphology result with a valid
grade (each of the 4 values), assert persistence and correct `flags: []`; reject an invalid grade
string (400, not silently coerced); accept a grade with a note, reject a note-only submission with no
grade; confirm the existing quantity-only e2e suite (`observation.e2e-spec.ts`, `calculated-
fields.e2e-spec.ts`) is unaffected by the widened discriminated union (full suite re-run). A real
`web-verify` headless-browser pass: load a Peripheral Film order's results screen, confirm the
graded control renders (not a numeric box), select a grade and an optional note, finalize, confirm
persistence on reload; confirm an existing CBC order's own numeric entry is visually/functionally
unchanged; dark mode and zero console errors.

## 9. Rollback plan

Additive only: no migration (finding #1 — the enum/constraint already exist), a widened
discriminated union (existing branches unchanged), new seed rows, a new UI branch gated on
`dataType === 'ordinal'` (every existing `quantity` row's own rendering path is untouched). Revert
the PR; existing CBC/chemistry entry is unaffected either way.

## 10. Questions requiring human approval

**Q1 — Morphology grading vocabulary: one shared 4-value scale, or per-analyte scales?**
- (a) **[Recommended]** One shared scale (`none`/`1+`/`2+`/`3+`) across Anisocytosis, Poikilocytosis,
  Polychromasia, and Platelet Estimate — matches KB-19's own literal example, simplest, no
  unjustified per-analyte variation invented.
- (b) Platelet Estimate uses a different scale (e.g. `low`/`normal`/`high`) since it's conceptually a
  quantity-adjacent estimate, not a morphology grade — more clinically idiomatic but a second
  vocabulary to define and validate with no real source dictating its exact values either.

**Q2 — v1 morphology scope: RBC morphology + platelet estimate only, or also a first WBC morphology
cut?**
- (a) **[Recommended]** RBC morphology (3 findings) + Platelet Estimate (1 finding) only — WBC
  morphology's own vocabulary is materially larger/more varied (finding #2 in §6), no partner data
  exists to seed it responsibly, and this AC's own literal text doesn't require it.
- (b) Add one or two of the most common WBC morphology findings now (e.g. toxic granulation, left
  shift) — more complete against KB-19's own full vision, but real, uncited vocabulary choices this
  proposal has no clinical source to ground.

**Q3 — Narrative notes: wired through for this feature only, or exposed generally on every result
type now?**
- (a) **[Recommended]** Ordinal (morphology) writes only, as scoped in §5 — the narrowest change
  that satisfies KB-19's own "narrative inside the structure" requirement for morphology
  specifically.
- (b) Expose `notes` as an optional field on every `resultEntrySchema` branch (quantity/coded/text
  too) — a real, small extra surface with no AC asking for it on non-ordinal results.

**Q4 — Should an ADR be drafted for widening `resultEntrySchema`'s dataType boundary (the first of
7 deferred values to become real) before this proposal is approved?**
- (a) **[Recommended]** Yes — draft it now, alongside this proposal, same pattern ADR-0023/ADR-0024
  already established this session. This is a real, precedent-setting extension mechanism future
  dataType work (boolean, datetime, ...) will likely follow.
- (b) No — treat this proposal's own §1/§5 as sufficient rationale, revisit via a future ADR only
  when a 5th dataType is actually added.
