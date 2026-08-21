# Implementation Proposal: Multi-protocol disambiguation + CAP colon/rectum protocol (issue #690, #551)

Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #690 (mechanism), #551 (protocol content)

## 1. Goal

Two coupled pieces of work, shipped together because one is unsafe
without the other:

1. **#690**: `synoptic/[partId]/page.tsx` resolves which protocol to
   render via a plain `.find()` on `specimenType` -- silently picks
   whichever protocol a list query happens to return first when more
   than one protocol shares a `specimenType`. Already live (the breast
   biomarker panel shares `specimenType: 'breast'` with the organ
   protocol) and blocks #551's next real-demand item.
2. **#551**: the design partner's own real, in-use local colon/rectum
   template (`D:\LIS\research\partner documents\COLON TEMPLATE.docx`,
   read in full) is CAP-flavored (AJCC 8th edition pT/pN, G1-G4 grading,
   CAP's own procedure list) -- structurally different from the ICCR
   "Colorectal Cancer" protocol already seeded. Per explicit product
   decision: both standards coexist, not one replacing the other.

## 2. Design (#690)

- `eligibleOrganProtocols = protocols.filter(p => p.specimenType === part.specimenType && !p.isPanel)`
  -- excluding `isPanel: true` protocols from organ-slot eligibility
  entirely (a panel is never the primary thing rendered on this page,
  only reachable via an organ protocol's own "Linked panels" list,
  #668). This alone fixes the already-live breast collision.
- 0 eligible: existing "no published synoptic protocol" message,
  unchanged.
- 1 eligible: that protocol, used exactly as today -- **zero behavior
  change for every existing single-protocol specimenType** (prostate,
  lung, cytology-pap, breast, and colorectal until this PR).
- 2+ eligible: a new `organProtocolId` query param (distinct from the
  existing `protocolId` param, which keeps its exact existing meaning --
  "which linked panel of the resolved organ protocol") selects among
  them. Absent, renders a "Choose reporting standard" picker (protocol
  name + sourceStandard) instead of silently picking one.
- Once the organ protocol is resolved (by the 1-eligible default or an
  explicit `organProtocolId`), everything downstream (`protocolId` for a
  linked panel, the "Linked panels" list) works exactly as #668 already
  built it -- panel links now also carry `organProtocolId` when
  disambiguation was needed, so "back" preserves the chosen standard.

## 3. Protocol content (#551)

New CAP-sourced `synoptic_protocol` ("Colon and Rectum (Resection)",
`sourceStandard: 'CAP'`, `specimenType: 'colorectal'`, `isPanel: false`),
additive alongside the existing ICCR "Colorectal Cancer" protocol --
same `specimenType`, now safely coexisting via #690's disambiguation.

Source: the design partner's own real, in-use local template (read in
full from the .docx XML, not summarized/paraphrased), itself a real,
recognizable subset of CAP's own official "Protocol for the Examination
of Specimens From Patients With Primary Carcinoma of the Colon and
Rectum" structure -- AJCC 8th edition pTNM. Flattened per task-645's own
established precedent (deeply-nested/heavily-conditional sub-branches to
their own top-level elements with `visibilityCondition`, optional
sub-branches not required for pilot completeness). Real element groups,
matching the partner's own document section-for-section: Procedure,
Tumor Site/Location, Histologic Type/Grade, Tumor Size, Tumor Extent
(pT-aligned), Sub-mucosal Invasion (pT1-only), Lymphatic/Perineural
Invasion, Tumor Budding, Treatment Effect, Margins (invasive + non-
invasive tumor), Regional Lymph Nodes + Tumor Deposits, Distant
Metastasis, pTNM Classification (pT/pN/pM per AJCC 8th), Additional
Findings.

## 4. Acceptance criteria

- #690: the already-live breast collision is fixed deterministically; a
  colorectal part now shows a real chooser between ICCR and CAP; every
  other existing specimenType is unaffected.
- #551: the CAP colon/rectum protocol is real, cited, recordable/
  readable through the existing unmodified recorder/read path, and
  reachable via the new chooser.

## 5. Out of scope

- Reconciling ICCR vs. CAP field-level divergence for the same organ
  (#553's own explicitly deferred process) -- both stand as independent,
  complete protocols, not merged/cross-mapped.
- Retroactively re-classifying any existing case already recorded
  against the ICCR colorectal protocol.

## 6. Questions requiring human approval

None -- "coexist, design the disambiguation mechanism" was the explicit
product decision already given.
