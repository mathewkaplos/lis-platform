# Implementation Proposal: Breast Biomarker Panel (ER/PR/HER2) (issue #551)

Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #551

## 1. Goal

#551 tracks "which organ site next" for the synoptic-protocol library, to
be "prioritized against real design-partner demand rather than built
speculatively." Breast biomarker content is that demand signal: the
design partner's own submitted documents mention it four separate times
(`Breast.Bmk_1.6.1.0.-REL_CAPCP.docx`, `breast cancer biomarkers.docx`/
`.pdf`, `breast ihc template.docx`, `BREAST CANCER TEMPLATE.docx`) --
more repetition than any other single topic in the research corpus. This
also directly completes #668's own work: the linked/composed biomarker-
panel mechanism was built this session with "no real panel content"
explicitly flagged out of scope.

## 2. Source content (real, cited)

- **CAP**: "Template for Reporting Results of Biomarker Testing of
  Specimens from Patients with Carcinoma of the Breast," Version
  1.6.1.0, Protocol Posting Date June 2025
  (`D:\LIS\research\cap documents\Breast.Bmk_1.6.1.0.-REL_CAPCP.docx`,
  read in full from the real .docx XML, not summarized/paraphrased,
  matching task-645's own precedent). Cites ASCO/CAP ER/PgR/HER2
  guideline updates (Allison et al. 2020; Wolff et al. 2018, 2023).
- **Design partner's own real, in-use local template**
  (`D:\LIS\research\partner documents\breast cancer biomarkers.docx`),
  read in full -- a simplified, real-world derivative of the same CAP
  structure: ER status/%/intensity, PgR status/%/intensity, HER2 IHC
  score (0/1+/2+/3+). Notably **no HER2 ISH section** -- a concrete,
  real signal this design partner doesn't perform in-house FISH/ISH
  testing, used below to scope ISH as optional rather than core.

## 3. Design

A new `synoptic_protocol` (`isPanel: true`, `sourceStandard: 'CAP'`,
`specimenType: 'breast'`), linked to the existing seeded "Invasive
Carcinoma of the Breast" (ICCR) protocol via `synoptic_protocol_linked_panel`
(#668) -- the linked/CAP shape, not inline composition, since a
biomarker panel is CAP's own real authoring shape for this content (the
issue #668 itself already established: "CAP treats biomarkers as
separate documents").

Per task-645's own established precedent (deeply-nested conditional
sub-branches flattened to their own top-level elements with
`visibilityCondition`, not option-specific sub-forms), and scoped to the
partner's own real, simplified usage rather than every CAP optional
sub-branch (heterogeneity patterns, alternative Allred scoring, etc. --
real content, genuinely out of scope for a pilot, matching #645's own
"Core elements plus directly-dependent Conditional elements... Optional
elements... not required for pilot completeness" carve-out):

- **ER**: `er_status` (required: positive / low_positive / negative /
  cannot_be_determined) -> `er_percentage_positive` (quantity, visible
  when positive/low_positive) + `er_intensity` (coded, same visibility)
  + `er_internal_control_status` (coded, visible when
  low_positive/negative) + `er_comment` (text).
- **PgR**: same shape, `pgr_status` (required: positive / negative /
  cannot_be_determined -- no distinct low-positive tier for PgR in the
  real CAP text, an asymmetry with ER that's real, not an omission) ->
  `pgr_percentage_positive` + `pgr_intensity` (visible when positive) +
  `pgr_internal_control_status` (visible when negative) + `pgr_comment`.
- **HER2 IHC**: `her2_ihc_score` (required, the real 4-bucket CAP core
  score: 0 / 1+ / 2+ equivocal / 3+ positive -- matching the partner's
  own simplified usage exactly) + `her2_ihc_comment` (text).
- **HER2 ISH**: `her2_ish_performed` (recommended, not required -- the
  partner's own real usage signal) -> `her2_ish_result` (visible when
  performed=yes; the real 5 CAP groups with their own real quick-
  reference ratio text as response option displays).

Every element binds to its own dedicated `analyte` (ADR-0050's own "one
writer for every protocol" / "no structured-atom-free element"
invariant, unchanged).

## 4. Acceptance criteria

- A real, cited CAP biomarker panel protocol exists, linked to the
  existing breast organ protocol via #668's linking mechanism.
- The panel is independently recordable/readable through the existing,
  unmodified recorder/read path (#668's own already-proven guarantee --
  no new mechanism, reusing what shipped this session).
- Reachable from the breast case's own synoptic recording page via the
  "Linked panels" UI #668 already built.

## 5. Out of scope

- Every CAP-optional sub-branch not reflected in the partner's own real
  usage (heterogeneity clustering, alternative Allred/other scoring
  systems, Ki-67 and other biomarkers the template also covers but the
  partner's own document doesn't use) -- opportunistic future extension,
  not required now.
- Any change to the existing breast organ protocol itself.

## 6. Questions requiring human approval

None -- real, cited source content; the one scope judgment (core vs.
optional fields) is grounded directly in the partner's own real,
submitted usage pattern, not a guess.
