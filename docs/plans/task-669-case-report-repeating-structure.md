# Implementation Proposal: Case-report renderer awareness of repeating structure (issue #669)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #669

## 1. Goal

`case-report-render.ts`'s hard-coded `drawCaseReport()` renders every
synoptic response as a flat `label: value` line per protocol group. Since
#666 landed repeating groups, a repeated instance's discrete Observations
all share the same element definition (same `label`), so two tumor foci
would render as two indistinguishable `Tumor Size: 12` / `Tumor Size: 8`
lines with no heading identifying which focus each belongs to -- data
recordable but not correctly displayable, the issue's own stated risk.

## 2. A real bug found while investigating, fixed here

`buildCaseReportContent()` (`case.controller.ts`) snapshots every
discrete Observation whose `analyteId` matches any `synoptic_element`,
scoped to the case's ordered tests -- with no `supersededBy` filter. Once
any element is re-recorded (#662's amendment chain), the OLD, now-
superseded Observation is never excluded: a signed report snapshots and
therefore renders *both* the old and new value for that element,
duplicated, forever. This isn't repeating-group-specific, but it's the
same class of defect the issue flags ("data recordable but not correctly
displayable") and directly affects the correctness of any signed version
going forward, including ones with a removed-then-not-resubmitted
repeating instance (its stale discrete Observation would otherwise leak
into the snapshot). Fixed by adding `isNull(observation.supersededBy)` to
the snapshot query -- taken *at sign time*, so an already-signed version's
own frozen snapshot is unaffected by a later amendment (the immutability
invariant proposal §2/§6 already established for `case_narrative` holds
here too).

## 3. Design: enrich at rejoin time, don't change the snapshot shape

The snapshot (`case_report_version.included_content.synopticResponses`)
stays a flat list of `{ id, createdAt }` discrete-Observation references
-- unchanged shape, avoiding a JSON-shape migration for already-signed,
immutable historical versions. What changes is `assembleCaseReportContent()`
(the rejoin step, already re-run at every view/download):

- A discrete Observation row has no stored composite `elementKey@instanceKey`
  -- that mapping exists *only* in the grid Observation's own
  `valueJson.results[].elementKey` (the same shape #659's read path
  already returns verbatim). The rejoin step now additionally loads each
  relevant grid Observation (`dataType='table'`, scoped to the same
  ordered tests) and builds an `observationId -> compositeElementKey` map
  from `results`, mirroring #659's own resolution -- not a new mechanism.
- For each discrete response, resolve its composite key via that map
  (falling back to the element's own plain `key` if no grid entry is
  found -- e.g. a pre-#666 signed snapshot, or the grid itself was later
  superseded past what's still queryable; renders correctly either way,
  just without instance grouping).
- `parseInstanceResponseKey` (already in `@lis/domain`, reused verbatim)
  splits the resolved key. A response with an `instanceKey` is grouped
  under its repeatable root's own `label` (found by walking
  `parentElementId` up the already-fetched element tree, the same
  `findRepeatableRoot` walk the recorder/frontend already use) plus an
  ordinal per distinct `instanceKey` in first-seen order (no real
  cross-instance ordering concept exists yet, matching #666's own
  "no UI reordering" decision) -- not the raw `instanceKey` UUID itself,
  which is a meaningless client-generated string to a report reader.

## 4. Shape change

`AssembledSynopticGroup` gains a second bucket alongside the existing
flat `responses` (unchanged, still used for every non-repeating
element):

```ts
interface AssembledSynopticRepeatingGroup {
  rootLabel: string;
  instances: { instanceLabel: string; responses: AssembledSynopticResponse[] }[];
}
interface AssembledSynopticGroup {
  protocolName: string;
  responses: AssembledSynopticResponse[];
  repeatingGroups: AssembledSynopticRepeatingGroup[];
}
```

`drawCaseReport()` renders `repeatingGroups` after `responses` within each
protocol section, one sub-heading (`rootLabel — instanceLabel`) per
instance, preserving the existing rejoin-at-render-time and
never-silently-drop properties (an unresolvable response still renders
`[data unavailable]`, exactly as today).

## 5. Acceptance criteria (defined here, per the issue's own deferral)

- A signed case report correctly displays every instance of a recorded
  repeating group, each under its own distinguishing heading.
- A re-recorded (amended) element renders only its current value, not a
  duplicate of the old one (the bug fix in §2).
- Non-repeating synoptic content renders exactly as before (no visual
  regression for any of the five existing seeded protocols, none of which
  use repeating groups yet).

## 6. Out of scope (per the issue's own exclusions)

- A general, authorable report-template mechanism for case-level content
  -- explicitly excluded by the issue itself.
- Concept-block/panel-composed content gets no special rendering beyond
  what composition already produces (ordinary elements, ordinary
  grouping) -- #667/#668 already guarantee composed elements behave like
  hand-authored ones everywhere, PDF rendering included.

## 7. Testing

Direct tests of `assembleCaseReportContent()` (a plain async function,
callable directly against the real DB/tx like every other unit here) --
more precise than asserting on raw PDF bytes (the existing PDF e2e tests
only check `%PDF-` header + byte-identical determinism, never text
content, and stay unchanged). New test-only repeatable elements (#666's
own precedent) with two recorded instances, confirming `repeatingGroups`
groups them correctly with distinct instance labels, plus a direct test
of the supersededBy-filter fix (record, re-record, sign, confirm only the
current value appears).

## 8. Questions requiring human approval

None -- acceptance criteria explicitly deferred to this proposal by the
issue itself.
