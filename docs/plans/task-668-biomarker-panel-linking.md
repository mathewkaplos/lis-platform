# Implementation Proposal: Linkable-or-inline biomarker/ancillary panel (issue #668)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #668

## 1. Goal

CAP treats biomarker panels (ER/PR/HER2, PD-L1, MMR, etc.) as separate,
cross-organ documents linked by pointer from the organ protocol; ICCR
embeds them inline as ordinary elements. Neither authoring shape exists
today. This issue's own acceptance criteria are explicitly deferred to
this proposal, scoped now that repeating-group support (#666) has landed.

## 2. Design

A biomarker panel is modeled as an ordinary `synoptic_protocol`/
`synoptic_protocol_version` (the issue's own "reuse this" instruction) --
no new authoring engine. Two composition shapes, both reusing
`synoptic_element` as the single underlying table (the issue's own
explicit requirement):

- **Linked (CAP's shape)**: `synoptic_protocol.isPanel boolean` marks a
  protocol as panel-shaped. `synoptic_protocol_linked_panel`
  (organProtocolId, panelProtocolId) declares which panel(s) an organ
  protocol recommends -- pure association, no element-tree coupling. A
  linked panel is recorded as its own, fully independent
  `assembleAndPersistSynopticResponse` call against its own published
  version and the same `orderedTestId` -- already fully supported by the
  existing recorder/read path (#659 already returns every protocol
  version's responses for a case, not just one), so linking needs zero
  recorder change. The only real gap is UI reachability.
- **Inline (ICCR's shape)**: `composeProtocolVersionElements`
  (`apps/api/src/synoptic-protocol/concept-block-composer.ts`, alongside
  #667's `composeConceptBlockVersion`) copies a panel *protocol version*'s
  own element tree (not a concept-block's) into a target organ protocol
  version at authoring time -- same compose-by-copy discipline, same
  cross-field visibilityCondition rewrite, same zero-recorder-change
  property. A second function rather than a generalized one: the two
  source tables (`synopticElement` vs. `conceptBlockElement`) are
  structurally identical but distinct Drizzle-typed tables: forcing one
  generic function through that type boundary is more complexity than two
  ~90-line functions sharing an obviously identical shape (three similar
  lines over a premature abstraction).

## 3. Schema

- `synoptic_protocol.isPanel boolean not null default false` -- metadata
  only; doesn't change eligibility/routing on its own.
- `synoptic_protocol_linked_panel` (id, organProtocolId FK, panelProtocolId
  FK, createdAt), `unique(organProtocolId, panelProtocolId)`.

## 4. API

- `GET /v1/synoptic-protocols/:id/versions/:versionId` gains
  `linkedPanels: { id, name, sourceStandard, publishedVersionId }[]` --
  resolved from `synoptic_protocol_linked_panel` for the *protocol*
  (`id`), not the version (a link is protocol-to-protocol, mirroring how
  a protocol "chooses" its current published version implicitly
  elsewhere in this engine -- ADR-0050's own precedent, not a new one).
  Empty array for a protocol with no linked panels (every existing
  protocol, until seeded otherwise).

## 5. Frontend

- `synoptic/[partId]/page.tsx` gains an optional `?protocolId=` search
  param: when present and it matches one of the organ protocol's own
  `linkedPanels` (validated -- not blindly trusted, for correct routing,
  not a security boundary; the recorder itself has never scoped by
  specimenType eligibility), renders that panel's own published version
  instead of the organ protocol's. Absent, renders the organ protocol as
  today, plus a new "Linked panels" section listing each `linkedPanels`
  entry as a link to the same page with `?protocolId=<panelId>` appended.

## 6. Out of scope (per the issue's own exclusions)

- Seeding any real biomarker panel content -- tracked under #551.
- The concept-block library (#667, separate issue/pattern).
- Whether a linked panel's responses get special `buildCaseReportContent()`
  snapshot handling -- the issue flags this as needing "a concrete answer
  during design": resolved here as *no special handling* for this slice --
  a linked panel is just another synoptic response against the same case,
  already included in report content exactly like any other protocol's
  response (#648's existing PDF assembly already rejoins every recorded
  synoptic response for a case, not protocol-specific). Revisit only if a
  real report-layout requirement surfaces that needs a panel's content
  grouped/labeled differently -- not assumed speculatively now.

## 7. Acceptance criteria (defined here)

- A protocol can be marked `isPanel` and linked from an organ protocol via
  `synoptic_protocol_linked_panel`.
- `GET .../versions/:versionId` surfaces an organ protocol's linked
  panels.
- A linked panel is independently recordable/readable through the
  existing, unmodified recorder/read path.
- `composeProtocolVersionElements` inline-composes one protocol version's
  element tree into another, with the same cross-field
  visibilityCondition-rewrite correctness #667 established.
- The synoptic recording page renders a linked panel reachably via
  `?protocolId=`, with a "Linked panels" section on the organ protocol's
  own page.

## 8. Assumptions & autonomous decisions

- Link is protocol-to-protocol, not version-to-version (§4) -- consistent
  with every other "protocol picks its own current published version"
  precedent in this engine.
- No UI for *authoring* links (creating `synoptic_protocol_linked_panel`
  rows) -- matches the existing gap (no protocol-authoring UI at all
  today); links are seed/script-authored, same as everything else.

## 9. Questions requiring human approval

None -- acceptance criteria explicitly deferred to this proposal by the
issue itself; the one open design question it flagged (§6, report-content
handling) is resolved with a stated, reversible default.
