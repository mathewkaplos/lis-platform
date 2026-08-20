# Implementation Proposal: Reusable concept-block library (issue #667)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #667

## 1. Goal

Staging, margins, and lymph-node status are not organ-specific -- nearly
every CAP/ICCR protocol re-declares them independently. Real, already-
seeded evidence of the cost: `synoptic-protocol-colorectal.sql`'s
`lymph_node_status` (a flat 6-value ICCR-style pN code) and
`synoptic-protocol-prostate.sql`'s `regional_lymph_node_status` +
`number_of_lymph_nodes_with_tumor` + `number_of_lymph_nodes_examined` +
`pathological_stage_pn` (a 4-field CAP-style structure with real
conditional visibility) are two independently hand-transcribed
representations of the same underlying concept, genuinely divergent in
shape between standards -- exactly the corpus finding the issue cites.

This issue's own acceptance criteria are explicitly undefined ("a
follow-on Implementation Proposal should define concrete, testable
acceptance criteria") -- defined here, scoped to what the issue itself
calls out as in-scope: build the library mechanism plus one real recurring
structure (Regional Lymph Nodes), not a full taxonomy.

## 2. Design decision: compose-by-copy, not live reference

Two shapes were considered for how a protocol version "uses" a concept
block:

- **Live shared reference**: `synoptic_element` rows reference a shared
  block-element row via FK. Rejected -- breaks the existing invariant that
  a published `synoptic_protocol_version`'s element tree is frozen (ADR-0050,
  the same immutability precedent `report_template_version` already
  establishes); would require `synoptic_element` to support two different
  parent scopes (protocol version vs. block version), a much larger blast
  radius for zero net benefit given protocols are already versioned as
  whole units, not field-by-field.
- **Compose-by-copy (chosen)**: a concept block is authored once, versioned
  independently; composing it into a protocol version copies its element
  tree into fresh `synoptic_element` rows scoped to that protocol version,
  remapping `parentElementId` links and prefixing `key`s. Zero schema
  change to `synoptic_element` itself, zero change to the recorder/read
  path/frontend renderer -- composed elements are ordinary elements
  afterward. Picking up a new block edition (e.g. a future AJCC edition)
  means authoring a new protocol version, exactly like any other content
  change already works today (no protocol-authoring API/UI exists yet --
  authoring is seed-SQL/script-driven, matching FEAT-058's own precedent).

## 3. Schema (new tables, additive)

Mirrors `synoptic_protocol`/`synoptic_protocol_version`/`synoptic_element`/
`synoptic_element_response_option` exactly, one level up:

- `concept_block` (id, key, name, createdAt) -- identity, e.g. key
  `regional_lymph_nodes`.
- `concept_block_version` (id, conceptBlockId, sourceStandard, version,
  status, effectiveFrom/To) -- `sourceStandard` lives on the *version*, not
  the block identity, since the same concept has a genuinely different CAP
  vs. ICCR shape (issue's own explicit requirement). Same status lifecycle
  as `synoptic_protocol_version`.
- `concept_block_element` -- same column shape as `synoptic_element`
  (parentElementId self-FK, key, label, dataType, requirement, analyteId,
  unitId, visibilityCondition, displayOrder, repeatable,
  identityElementKey), scoped to `concept_block_version_id`.
- `concept_block_element_response_option` -- mirrors
  `synoptic_element_response_option`.

## 4. Composer

`apps/api/src/synoptic-protocol/concept-block-composer.ts`:
`composeConceptBlockVersion(tx, { conceptBlockVersionId,
targetProtocolVersionId, parentElementId, keyPrefix, displayOrderOffset })`
-- reads the block version's full element tree + response options in one
query each, inserts fresh `synoptic_element`/`synoptic_element_response_option`
rows under `targetProtocolVersionId`, remapping each element's
`parentElementId` from a block-element id to its newly-inserted
counterpart's id (root block elements attach to the caller-supplied
`parentElementId`, or top-level if null) and its `key` to
`${keyPrefix}${originalKey}` (required, not defaulted -- composing the same
block twice into one protocol version, e.g. two lymph-node regions, needs
distinct prefixes to satisfy `ux_synoptic_element_version_key`;
`displayOrderOffset` keeps composed elements sorted as a contiguous block
rather than interleaving with hand-authored ones at their original
small `displayOrder` values).

No REST endpoint -- this is an authoring-time tool, not a runtime request
path, matching the existing gap (there is no protocol-authoring API today;
authoring is direct seed SQL). Exposed as a plain importable function,
directly exercised by an e2e test the same way #664/#666 already prove a
mechanism without a dedicated admin surface.

## 5. Seed content: one real concept, two real variants

`db/seed/concept-block-regional-lymph-nodes.sql`: `regional_lymph_nodes`
concept block, two published versions --
- **ICCR variant**: `lymph_node_status`, the exact 6-option pN0-pN2b coded
  field already real and cited in
  `synoptic-protocol-colorectal.sql` (values/labels copied verbatim, not
  re-invented).
- **CAP variant**: the exact 4-field structure already real and cited in
  `synoptic-protocol-prostate.sql` (`regional_lymph_node_status` +
  `number_of_lymph_nodes_with_tumor` + `number_of_lymph_nodes_examined` +
  `pathological_stage_pn`, including their real conditional
  visibilityConditions).

Existing colorectal/prostate seed content is left untouched (out of
scope -- re-pointing already-working, already-tested real protocols at the
new library is a separate follow-on, not required to prove the mechanism,
and touching real seed content carries real regression risk for no
proportionate benefit in this issue).

## 6. Acceptance criteria (defined here, per the issue's own deferral)

- `concept_block`/`concept_block_version`/`concept_block_element`/
  `concept_block_element_response_option` schema exists, versioned/
  status-lifecycled like `synoptic_protocol_version`.
- One real concept (Regional Lymph Nodes) exists as two real, cited
  concept block versions, one per source standard, structurally
  divergent -- not a forced-universal shape.
- `composeConceptBlockVersion` copies a block version's tree into a target
  protocol version, correctly remapping parent links and key prefixes.
- A composed element set is recordable and readable through the existing,
  *unmodified* recorder (#658) and read path (#659) -- proving zero
  downstream changes are needed, the issue's own core promise.

## 7. Out of scope

- Building the library for every organ/structure up front (issue's own
  explicit exclusion) -- staging and margins are follow-on work once this
  mechanism is proven.
- Re-pointing existing colorectal/prostate seed content at the library.
- Any protocol-authoring UI/API -- authoring stays script/seed-driven,
  matching current practice.
- Edition-independent versioning coordination with issue #553 (protocol
  reconciliation process) -- the issue itself flags this as needing to be
  "designed together" with #553, which isn't itself scoped yet; the schema
  chosen here (`concept_block_version.version` + status lifecycle,
  identical shape to `synoptic_protocol_version`) is deliberately the same
  shape #553 would need to reconcile against, not a shape that forecloses
  that later design.

## 8. Assumptions & autonomous decisions

- Compose-by-copy over live-reference (§2) -- a technical architecture
  call, not a product/business decision; the issue's own "Already
  implemented (reuse this)" section endorses building *on* the existing
  frozen-version model, not replacing it.
- Lymph nodes chosen as the one structure to build now (over staging or
  margins) -- already has the clearest, most complete real divergent
  evidence already sitting in two existing seed files, minimizing
  fabricated content.

## 9. Questions requiring human approval

None for this scoped slice. Cross-issue coordination with #553 (§7) is
explicitly left for whenever #553 itself is scoped -- not a blocker here.
