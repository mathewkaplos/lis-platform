# Implementation Proposal: Part-scoped synoptic responses (issue #674)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #674

## 1. Goal

Synoptic responses are recorded against `orderedTestId` only, resolved
client-side as `order.orderedTests[0]?.id` -- the *same* value regardless
of which part's recording page is used. A case with two synoptic-eligible
parts recorded against the same protocol produces two grid Observations
that are structurally indistinguishable. Worse than a read-path gap: the
recorder's own predecessor-lookup (keyed on `orderedTestId` + the shared
grid analyte) would treat the *second* part's recording as an amendment
of the *first* part's grid, incorrectly marking it superseded. This is a
real, live data-correctness bug, not just a retrieval limitation.

## 2. Design: `observation.specimenId` -- already exists, never populated

Confirmed by direct inspection: `observation.specimenId` (nullable,
`references specimen(id)`) already exists on the table (ADR-0015) --
**no migration needed at all**. The gap is purely that the synoptic
recorder never writes it. This is the simplest possible fix shape: reuse
the exact column ADR-0015 already put there for "which physical unit
does this Observation describe," the same one every other discipline's
own Observation-writing path already benefits from, rather than adding a
new column or a parallel join table.

## 3. Scope

- No schema change.
- **Recorder** (`assembleAndPersistSynopticResponse`): new required
  `specimenId` param, written onto every discrete + grid Observation
  insert. The predecessor-grid lookup query gains
  `eq(observation.specimenId, specimenId)` alongside its existing
  `orderedTestId` filter -- this is the actual fix for the
  amendment-chain corruption, not just retrieval.
- **Controller** (`POST /v1/cases/:id/synoptic-responses`): accepts
  `specimenId` in the body, validates it belongs to the case (same
  pattern the existing `orderedTestId`-belongs-to-case check already
  uses), passes through to the recorder.
- **Read path** (`GET /v1/cases/:id/synoptic-responses`): grouping key
  changes from `(orderedTestId, synopticProtocolVersionId)` to
  `(specimenId, synopticProtocolVersionId)` per the issue's own explicit
  instruction -- `specimenId` (including `NULL`, which groups together
  exactly like today's pre-migration behavior) replaces `orderedTestId`
  as the distinguishing half of the key.
- **Frontend**: `synoptic/[partId]/page.tsx` passes the real `partId` (=
  `specimen.id`) through to the record action; `ProtocolForm`/`actions.ts`
  include it in the POST body.

## 4. Accepted transitional limitation

A case that recorded a synoptic response *before* this migration
(`specimenId NULL`) and re-records *after* it (`specimenId` now set)
loses amendment-chain continuity for that one transition -- the new,
part-scoped recording won't match the old `NULL`-specimenId predecessor
via the tightened lookup, so it's treated as a first-ever recording
rather than an amendment. Accepted, not solved: no production clinical
data exists yet for this in-development milestone, and a real backfill
(inferring which historical grid belongs to which part) has no reliable
signal to do it by (the very gap this issue exists to close). Documented
here rather than engineered around speculatively.

## 5. Acceptance criteria (from the issue, restated)

- Two eligible parts on the same case, recorded against the same
  protocol, are each independently retrievable and distinguishable.
- Existing single-eligible-part cases behave identically to before.

## 6. Out of scope

- Response versioning/supersession within a single part's own recording
  history (#662, separate and already correct).
- Revisiting `orderedTestId`'s own resolution
  (`order.orderedTests[0]?.id`) -- out of scope per the issue's own
  "Design considerations," left as-is; `specimenId` is now the real
  per-part distinguishing key, so `orderedTestId` staying case-wide is no
  longer a correctness gap.

## 7. Questions requiring human approval

None -- schema/recorder/API work with a defined, literal acceptance
criterion; the one design choice (column vs. join table) is a technical
call following the table's own existing precedent.
