# Implementation Proposal: FEAT-062 — Cytology v1: Bethesda-coded Pap reporting & adequacy tracking
Status: APPROVED
ADR: none (fits the existing mechanism unchanged — see §5)

**Approved 2026-08-13** via the native options-prompt — all four §10 questions answered with the
Recommended option as drafted: (1) reuse block/slide literally, (2) adequacy + interpretation
category only in v1, (3) new adequacy-rate report route, (4) no new ADR.
Date: 2026-08-13    Backlog ID: #541 (FEAT-062, depends on FEAT-057 #538, FEAT-058 #539, FEAT-059 #544)

## 1. Goal

Cervical/Pap cytology reporting using the Bethesda System as a coded value set — adequacy
(satisfactory/unsatisfactory + reason) as a first-class coded Observation tracked as a quality
metric, and interpretation category (NILM, ASC-US, ASC-H, LSIL, HSIL, AGC, AIS, malignant, etc.)
as a coded Observation from a controlled value set. KB-16's own "pure-metadata discipline" framing
and KB-18's explicit "reuse anatomic-pathology model" decision both point the same direction:
**this is not a new mechanism** — it is FEAT-058's generic synoptic-protocol engine applied to a
new, real, cited protocol (Bethesda 2014), running over FEAT-057's own Case/Specimen/Block/Slide
model and FEAT-059's own sign-out mechanism, entirely unchanged. Confirmed directly during
planning, not assumed: no new table, no new route, no new capability is required by either of this
feature's own two structural ACs.

## 2. Affected files

- `db/seed/synoptic-protocol-cytology-pap.sql` (new) — a real, cited Bethesda System 2014 protocol
  (`synoptic_protocol`/`synopticProtocolVersion`/`synopticElement`/`synopticElementResponseOption`,
  the exact same global/RLS-exempt tables FEAT-058 already built and seeded breast/colorectal
  into — no schema change). Two required elements per AC #1/#2:
  - `specimen_adequacy` (coded, required): `satisfactory` | `unsatisfactory_for_evaluation`.
  - `adequacy_reason` (coded, visible only when `specimen_adequacy = unsatisfactory_for_evaluation`
    via the existing `visibilityCondition` mechanism — the same real pattern the colorectal
    protocol's own `plane_of_mesorectal_excision` already demonstrates): obscuring
    blood/inflammation, scant squamous cellularity, air-drying artifact, insufficient
    epithelial cells (real Bethesda-documented unsatisfactory reasons — sources below).
  - `interpretation_category` (coded, required): `NILM` | `ASC-US` | `ASC-H` | `LSIL` | `HSIL` |
    `AGC, NOS` | `AGC, favor neoplastic` | `AIS` (endocervical adenocarcinoma in situ) |
    `squamous cell carcinoma` | `adenocarcinoma` | `other malignant neoplasm` — the real Bethesda
    2014 taxonomy (sources below), not fabricated.
  - Organisms/other non-neoplastic findings (KB-18's own "coded where standardised") are real
    Bethesda categories too but **deliberately out of this v1 protocol** — neither AC requires
    them; adding them is additive seed-data work for a later feature, not a reason to widen this
    one's own scope (matching FEAT-058's own breast/colorectal-only v1 scoping discipline).
  - **Sources** (real, freely accessible, not a paid CAP eCC license — matching FEAT-058's own
    sourcing discipline): Nayar R, Wilbur DC (eds.), *The Bethesda System for Reporting Cervical
    Cytology: Definitions, Criteria, and Explanatory Notes*, 3rd ed., Springer, 2015 (the official
    2014 Bethesda System publication) for the adequacy/interpretation category definitions;
    IARC/WHO Screening Group's own freely-published Bethesda classification atlas
    (screening.iarc.fr/atlasclassifbethesda.php) for the exact category taxonomy, cross-checked
    against Nayar & Wilbur's own 2015 *Cancer Cytopathology* summary ("The Pap test and Bethesda
    2014," doi:10.1002/cncy.21521) — both fetched and read directly this session, not assumed
    from training-data memory alone.
- `scripts/db-reset.sh`, `.github/workflows/pr.yml` — wire the new seed file (after the
  colorectal/breast synoptic seeds — no ordering dependency on them, but keeping all
  synoptic-protocol seeds grouped together).
- `apps/api/src/report/operational-reports.service.ts` — new `computeAdequacyRateReport(tx,
  params)`, mirroring `computeRejectionRateReport`'s own exact shape (§3): queries discrete
  Observations bound to the `specimen_adequacy` element's own analyte within a date range,
  computes satisfactory/unsatisfactory counts + rate. Resolves "the adequacy analyte" via
  `synopticElement.key = 'specimen_adequacy'` (protocol-agnostic — a future second cytology
  system reusing the same element key convention is automatically included, no report-code
  change needed).
- `apps/api/src/report/operational-reports.controller.ts` — new `GET
  v1/reports/operational/adequacy-rate` route, same `view_operational_reports` capability gate,
  same unaudited-read reasoning, as the three existing operational report routes.
- `packages/domain/src/operational-reports.ts` — new `adequacyRateReportSchema`.
- `apps/api/src/report/operational-reports.service.spec.ts` — unit coverage for
  `computeAdequacyRateReport`'s own rate math (mirrors the existing rejection-rate spec's shape).
- `apps/api/test/cytology-pap.e2e-spec.ts` (new) — full real flow proving all three issue ACs:
  create a cytology Case/Specimen/Block/Slide (FEAT-057's existing routes, unchanged), record a
  real Bethesda synoptic response (FEAT-058's existing `POST /v1/cases/:id/synoptic-responses`,
  unchanged), sign it out via FEAT-059's existing `POST /v1/cases/:id/finalize` (real step-up,
  unchanged), and confirm the new adequacy-rate report reflects it.
- `apps/api/test/operational-reports.e2e-spec.ts` — add the new route's own AC coverage,
  matching the existing file's own per-route test grouping (tat/workload/rejection-rate already
  live there; adequacy-rate joins them, not a new file, since it's the same resource/controller).

No new migration, no new table, no new capability, no new controller/module.

## 3. Architecture consulted

- **KB-18 Cytology** (read in full) — "Reuse anatomic-pathology model... Consistency; less bespoke
  machinery" is the explicit, accepted design decision this proposal implements literally, not
  reinterprets. "Each reportable element is a coded Observation... adequacy rates, category
  distributions, and reflex triggers are computable directly" — confirms the adequacy-rate report
  is real, intended functionality, not over-scope.
- **KB-16 Laboratory Disciplines** (read in full) — the "pure-metadata disciplines... pack-only"
  framing; a discipline pack is "versioned, tenant-installable metadata" (specimen model, analyte/
  test catalog, template pack) the *existing* core loads, never a core-code branch. This proposal
  is the concrete instance: cytology adds zero core code, only a Bethesda-shaped pack (seed data)
  plus one new report the KB explicitly names as a natural consequence ("adequacy rates... are
  computable directly").
- **`apps/api/src/case/case.controller.ts`'s `finalize()`** (re-read for this proposal) — its
  existing lineage-completeness check (every part needs ≥1 active block with ≥1 active slide) was
  written for histology's own case shape (FEAT-057) but is **not histology-specific in any way** —
  `block`/`slide` have no discipline-specific columns at all, just numbering/codes. A cytology
  specimen (a Pap slide/vial) fits this unchanged as a 1-block-1-slide-per-part case: the "block"
  is the prepared slide-carrier, the "slide" is the actual smear — verified directly this session
  (§8) against a real Postgres instance, not assumed correct from reading the code alone.
- **`packages/domain/src/specimen.ts`** — confirmed `specimenType` is already a plain,
  unconstrained `text` column (`specimenTypeSchema = z.string().min(1)`), not an ENUM — a cytology
  specimen type (e.g. `'cervical_cytology'`) needs no schema change, just a new string value at
  the call site, same as every other specimen type already in use.
- **`apps/api/src/synoptic-protocol/synoptic-response-recorder.ts` + `.controller.ts`** (re-read) —
  confirmed the existing `POST /v1/cases/:id/synoptic-responses` route is fully protocol-agnostic
  (takes a `synopticProtocolVersionId` + responses, no histology-specific logic anywhere) — a
  cytology case uses it completely unchanged.
- **`apps/api/src/report/operational-reports.controller.ts` + `.service.ts`** (re-read) — the exact
  `computeRejectionRateReport`/`GET .../rejection-rate` shape mirrored for adequacy-rate: same
  `from`/`to`-required query, same `view_operational_reports` gate, same unaudited-read reasoning.
- **`db/seed/synoptic-protocol-colorectal.sql`** (re-read) — the exact `visibilityCondition` usage
  pattern (`plane_of_mesorectal_excision`'s own conditional-on-`tumor_site`) mirrored for
  `adequacy_reason`'s conditional-on-`specimen_adequacy`.
- **`engineering/database-design`** and **`engineering/api-design`** Skills (both loaded in full,
  same entries already summarized in FEAT-057/058/059/060/061's own proposals this session —
  entry #12 in particular: any new `db/seed/*.sql` file needs both `db-reset.sh` AND `pr.yml`
  wired, in the same PR, checked explicitly here).
- **Real Bethesda System sourcing** (WebSearch + WebFetch, this session) — Nayar & Wilbur 2015 (the
  official 2014 Bethesda System text), the IARC/WHO Screening Group's own freely-published
  classification atlas, and Nayar & Wilbur's own 2015 *Cancer Cytopathology* summary — all fetched
  and read directly, not assumed from training-data memory alone, matching FEAT-058's own ICCR
  sourcing discipline (never fabricate clinical/coding-system content).

## 4. Skills loaded

`engineering/database-design` (full, 17 entries), `engineering/api-design` (full, 16 entries).

## 5. Assumptions & autonomous decisions

- **No new ADR** — the issue's own "write one only if a real gap is found" is resolved: none was.
  Bethesda fits the existing synoptic-protocol/Case-Specimen-Block-Slide/sign-out mechanism
  unchanged, confirmed directly by re-reading the relevant code (§3), not merely asserted.
- **Cytology "block"/"slide" are the existing generic tables, reused literally, not renamed or
  branched.** A Pap specimen's single prepared slide is one `block` row (`blockNumber: 1`) with
  one `slide` row (`slideNumber: 1`) — no schema change, no discipline discriminator column. This
  is the literal, minimal reading of KB-18's "reuse... less bespoke machinery" decision, not a
  workaround.
- **Organisms/other non-neoplastic Bethesda findings are out of this v1 protocol's own scope** —
  real, real Bethesda categories, but neither issue AC requires them; adding them is a real,
  separate, additive follow-up (same discipline FEAT-058 already established for
  Paris/Milan/thyroid systems, issue #550's own "deferred, not silently dropped" framing).
- **The two-tier screening workflow (screen → cytotechnologist → review → cytopathologist
  sign-out, KB-18's own second major design decision) is explicitly out of this feature's own
  scope** — it is FEAT-063's own issue (`Cytology two-tier workflow`), already filed separately in
  EPIC-012's own v1 slice. AC #3 ("signed out end to end via the FEAT-059 mechanism") is satisfied
  by the existing single-tier sign-out unchanged; the two-tier variant is additive workflow-engine
  configuration FEAT-063 builds on top, not something this proposal needs to anticipate structurally.
- **Reflex (ASC-US → HPV) is explicitly out of this feature's own scope** — it is FEAT-064's own
  issue (`Cytology reflex: ASC-US → HPV management`), reusing FEAT-060's own `AddReflexTest`/
  `AddBlockReflexTest` command pair unchanged (a workflow-rule configuration problem, not a code
  problem, per KB-25's own established pattern) once this feature's own real `interpretation_category`
  value set exists for a rule's `when` to match against.
- **`computeAdequacyRateReport` resolves the adequacy analyte via `synopticElement.key =
  'specimen_adequacy'`**, not a hardcoded analyte id or a new dedicated lookup table — protocol-
  agnostic by construction, matching KB-16's own "the core never learns the name of any specific
  discipline" principle applied to a report, not just a write path.

## 6. Risks

- **`operational-reports.e2e-spec.ts` already carries a real, pre-existing timing fragility**
  (issue #565, found and filed during FEAT-061, confirmed 3 times this session) — adding a new
  test case to that same file inherits that file's own existing flake risk on a full-suite run;
  not this proposal's own regression, already tracked separately, not fixed here.
- **Real Bethesda category coding beyond the two required elements (organisms, staging/HPV
  co-testing correlation) is genuinely incomplete** relative to full real-world Pap reporting —
  explicitly scoped out (§5), flagged here rather than silently implied as "done."
- **`case.controller.ts finalize()`'s lineage-completeness check working correctly for a
  1-block-1-slide cytology case is asserted from direct code re-reading, not yet proven against a
  real Postgres instance until this proposal's own e2e spec runs** — verified for real in §8, not
  left as an assumption once implementation starts.

## 7. Acceptance criteria

Per issue #541's own 3 ACs:
- [ ] Adequacy is captured as a coded Observation and is queryable as a standalone adequacy-rate
  metric — proven by a real `specimen_adequacy` synoptic response recorded, then reflected
  correctly in `GET /v1/reports/operational/adequacy-rate`'s own real satisfactory/unsatisfactory
  counts.
- [ ] Interpretation category is a coded Observation from a controlled Bethesda value set — proven
  by recording a real `interpretation_category` response against the real seeded value set and
  confirming the API rejects a value outside it (the existing synoptic-response-recorder's own
  validation, unchanged, exercised against new real data).
- [ ] A Pap case can be signed out end to end via the FEAT-059 mechanism — proven by a real
  Case→Specimen(cytology)→Block→Slide→synoptic-response→finalize (step-up + signature) round trip,
  the exact same mechanism `case-sign-out.e2e-spec.ts` already proves for histology, now exercised
  against a cytology-shaped case for the first time.

## 8. Testing plan

1. Fresh `db-reset.sh` (new seed file wired), confirm the new protocol appears in
   `GET /v1/synoptic-protocols` alongside breast/colorectal.
2. `operational-reports.service.spec.ts` — `computeAdequacyRateReport`'s own rate math (all-
   satisfactory, all-unsatisfactory, mixed, zero-rows-in-range boundary cases).
3. `cytology-pap.e2e-spec.ts` — the full real round trip (§2), covering all three ACs, including a
   direct verification that `case.controller.ts finalize()`'s existing completeness check accepts
   a 1-block-1-slide-per-part cytology case without any code change (§6's own risk, closed here).
4. `operational-reports.e2e-spec.ts` — the new `adequacy-rate` route's own request-shape/gating
   tests (400 missing from/to, 403 non-qa, RLS cross-tenant), matching the existing three routes'
   own test shapes exactly.
5. Full local verification: fresh db-reset → new files in isolation → one final fresh-reset +
   full-suite run, this session's own established discipline (aware of #565's own pre-existing
   flake risk on the full run, not a new regression if it recurs).
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Purely additive: one new seed file, one new report method/route/schema, one new e2e spec. No
existing table, route, or seed file is modified except the two seed-wiring files (`db-reset.sh`,
`pr.yml`), both trivially revertible. Reverting the PR removes the Bethesda protocol and the
adequacy-rate route; nothing else in the system references either.

## 10. Questions requiring human approval

All four resolved 2026-08-13, Recommended option selected in every case:
1. **RESOLVED — no new ADR.**
2. **RESOLVED — cytology reuses `block`/`slide` literally** (1-block-1-slide per Pap specimen).
3. **RESOLVED — Bethesda v1 protocol scope is adequacy + interpretation category only**,
   organisms/other findings explicitly deferred.
4. **RESOLVED — new `adequacy-rate` operational report route**, mirroring the existing three
   routes exactly.

**No further questions — implementation begins now.**
