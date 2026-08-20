# Implementation Proposal: Anatomic Pathology synoptic protocol recording UI
Status: APPROVED
ADR: adr-0050 (FEAT-058, existing)    Date: 2026-08-20    Backlog ID: issue #642 (lis-platform)

**Implementation note (added during development, not a plan revision):** this proposal's own §1
claim of "zero backend changes" turned out to be one field short. `GET /v1/synoptic-protocols`'s
response had no way for a caller to discover a protocol's *published version id* — the pre-existing
`synoptic-protocol.e2e-spec.ts` itself had to resolve it via a direct DB query, which a browser
client obviously cannot do. Fixed with the smallest possible addition: a nullable
`publishedVersionId` field on each list entry (resolved via a left-join against
`synoptic_protocol_version` filtered to `status = 'published'`, which the table's own
`ux_synoptic_protocol_version_protocol_published` partial unique index guarantees is at most one
row). No new route, no schema/migration change (a plain `SELECT`, not a new column), and squarely
within §1's own "unless implementation genuinely uncovers a gap" carve-out — not scope creep.

## 1. Goal

Give a pathologist a browser UI to record a case's synoptic (CAP/ICCR structured-checklist)
report, for the three real, published protocols already seeded in this repo (Breast ICCR,
Colorectal ICCR, Cervical Cytology/Pap Bethesda). FEAT-058 (ADR-0050) already built the entire
backend for this — schema, validation, the recording route, lifecycle snapshotting into the
signed report, audit, and reflex-rule integration. **Zero of it has any browser UI today.** This
is the tenth AP slice broken out of #610 this session, and the first that is purely a frontend
consumer of an already-complete API — no schema or backend change is in scope unless
implementation genuinely uncovers a gap (none is currently known; see §5).

The UI must be a **generic protocol renderer** — one component that walks whatever
section/element tree `GET /v1/synoptic-protocols/:id/versions/:versionId` returns — not three
separate Breast/Colorectal/Pap-specific forms. See §3 for the exact data flow and §3.1 for why,
in the three real seeded protocols, that tree is currently flat (no protocol uses grouping today,
even though the schema supports it).

## 2. Affected files

- `packages/domain/src/conditions.ts` — add `evaluateCondition` (moved from
  `apps/api/src/workflow/workflow-condition-evaluator.ts`, not duplicated — see §5.1).
- `apps/api/src/workflow/workflow-condition-evaluator.ts` — re-export `evaluateCondition` from
  `@lis/domain` instead of defining it locally (mirrors how `ConditionNode`/`isConditionLeaf`
  already moved to `@lis/domain` for FEAT-047, re-exported from `workflow-types.ts` unchanged).
  `findUnallowedFields` (publish-time-only, apps/api-only caller) stays where it is.
- `apps/api/src/workflow/workflow-condition-evaluator.spec.ts` — no logic change; still exercises
  the same function, now imported from `@lis/domain`. Confirms the move is behavior-preserving.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — add a "Record synoptic protocol" entry link per
  eligible part (specimenType exact-matches a published protocol).
- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/page.tsx` (new) — Server Component: fetch
  the case, the matching published protocol version, and the order (to resolve `orderedTestId`).
- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/protocol-form.tsx` (new) — Client Component:
  the generic protocol renderer + `useActionState` submit form.
- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/actions.ts` (new) — `'use server'` action,
  raw `fetch` POST to `/v1/cases/:id/synoptic-responses`.
- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/types.ts` (new) — `State`/initial-state
  constant, per `frontend-design` Skill entry #8 (must not live in the `actions.ts` file).
- No files under `apps/api`, `packages/db`, or `packages/domain`'s `synoptic-protocol.ts` change
  at all — the entire recording contract is reused verbatim.

## 3. Architecture consulted

- ADR-0050 / `docs/plans/feat-058-generic-synoptic-protocol-engine.md` (the backend this UI
  consumes).
- ADR-0029 (`ConditionNode`/`evaluateCondition` origin, workflow engine).
- ADR-0049 §Decision 3 (per-Case grouping — recording addresses the case, not the part/order
  directly).
- This session's own research pass on this exact gap (superseded by this proposal's own
  independent re-verification below — every claim re-checked against the live checkout, not
  trusted from the summary, per this project's standing "never draft from a summary alone"
  discipline).

### 3.1 Data flow (re-verified directly against the current checkout)

```
Case  (GET /v1/cases/:id -- caseData.orderId is a real z.uuid() field, confirmed in
  |                          packages/domain/src/anatomic-pathology.ts:43/51 and returned by
  |                          toCaseDto()'s row spread, case.controller.ts:99-105)
  v
Part  (caseData.parts[n], specimenType: specimenTypeSchema -- free text, matches
  |     specimen.specimenType's own convention; eligibility = exact match against a
  |     published synoptic_protocol.specimenType)
  v
Order (GET /v1/orders/{caseData.orderId} -- JwtAuthGuard only, no capability gate,
  |     order.controller.ts:250-254; response includes orderedTests: OrderedTest[],
  |     packages/domain/src/order.ts:65-102)
  v
OrderedTest (orderedTests[0].id -- the anchor the recording route requires; see §5.2 for
  |           why "first ordered test on the order" is the correct default here, not a hack)
  v
Synoptic Protocol Version (GET /v1/synoptic-protocols/:id/versions/:versionId --
  |                          JwtAuthGuard only, synoptic-protocol.controller.ts:89-157;
  |                          returns { ...version, elements: SynopticElement[] } sorted by
  |                          displayOrder, each with its own responseOptions[])
  v
Synoptic Elements (each: { key, label, dataType: coded|quantity|text, requirement:
  |                 required|recommended, parentElementId, visibilityCondition, displayOrder,
  |                 responseOptions[] } -- packages/domain/src/synoptic-protocol.ts:26-39)
  v
Visibility Conditions (ConditionNode tree, evaluateCondition(node, context) -- pure,
  |                      dependency-free function; context is a flat
  |                      Record<elementKey, value> built from the in-progress form state)
  v
User Responses ({ elementKey, value: string | number }[] -- the UI's own React state,
  |               one entry per element the user has answered)
  v
POST /v1/cases/:caseId/synoptic-responses
  |  body: { orderedTestId, synopticProtocolVersionId, responses }
  |  manage_specimens capability, no step-up (recording.controller.ts:170-210) -- this is
  |  draft-time documentation, not the diagnostic gate; finalize()'s own verify+step-up stays
  |  the real sign-off, identical reasoning to issue #636's narrative route
  v
assembleAndPersistSynopticResponse (apps/api/src/synoptic-protocol/synoptic-response-recorder.ts:87-314)
  |  -- validates every non-hidden required element is present (re-evaluating
  |     visibilityCondition server-side, authoritatively -- the client's own live evaluation
  |     is UX only, never trusted); validates coded values against response_option; writes
  |     one discrete `observation` row per answered element + one `table`-dataType grid
  |     observation; one audit event (synoptic.record); one unconditional
  |     SynopticResponseRecorded outbox event (FEAT-064's ASC-US->HPV reflex consumes this)
  v
Existing report snapshot at finalize/amend (buildCaseReportContent(), case.controller.ts:248-327
   -- re-read directly for this proposal, confirmed UNCHANGED by issue #639's own recent edits
   to this file: lines 268-273 collect every synopticElement.analyteId, lines 275-288 filter the
   case's own order's observation rows to just those analyte ids and snapshot {id, createdAt}
   pairs by reference -- safe because a verified observation row is immutable via a real DB
   trigger, unlike case_narrative which #636 had to snapshot by value)
```

### 3.2 Real finding: `parentElementId` grouping exists in the schema but is unused by every real seeded protocol

`packages/db/src/schema/synoptic-protocol.ts:73` defines `parentElementId` as a self-referencing
FK specifically for grouping (per its own header comment, "mirrors `specimen.parentSpecimenId`'s
own `AnyPgColumn`-typed pattern, for grouping"). **Confirmed directly by grep of all three real
seed files (`db/seed/synoptic-protocol-{breast,colorectal,cytology-pap}.sql`): zero elements in
any of the three set a `parent_element_id`.** Every seeded protocol is a single flat list of
elements, ordered by `display_order` (25 elements for Breast, 26 for Colorectal, fewer for Pap).

This does not mean the "Protocol → Section → Element" tree the issue asks for is fictional — it
means the renderer must be built generically (walk `parentElementId` recursively, group children
under their parent, render a flat top-level list as its own implicit unsectioned group) so that a
**future** protocol version that does use grouping renders correctly with no code change, but
**today**, all three real protocols render as one ordered list of elements with no sub-headers.
Stating this plainly rather than fabricating section boundaries that don't exist in the real data
(per this session's own "don't assume conventional workflows override this repository's
architecture" discipline, and per the issue's own explicit requirement that this NOT become a
form-builder speculative-feature project).

```
Protocol: "Invasive Carcinoma of the Breast" (ICCR, v1, published)
  Section: (none -- no element sets parentElementId in the real data)
    Element: neoadjuvant_therapy       (coded, required)
    Element: operative_procedure       (coded, required)
    Element: specimen_laterality       (coded, required)
    Element: tumor_site                (coded, required)
    Element: tumor_distance_from_nipple_mm (quantity, recommended)
    Element: tumor_focality            (coded, required)
    Element: tumor_focus_count         (quantity, recommended, visibilityCondition: see §3.3)
    ... (18 more elements, all siblings, ordered by displayOrder)
```

The renderer component itself is written as a recursive `ElementGroup({ elements, parentId })`
that filters `elements.filter(e => e.parentElementId === parentId)` — genuinely generic, genuinely
capable of nesting, just exercised at depth 1 by every protocol that exists today.

### 3.3 Concrete visibility-rule worked example, using real seeded data

From `db/seed/synoptic-protocol-colorectal.sql:105-124` (read directly, not summarized):

```
Element A: neoadjuvant_therapy
  key: "neoadjuvant_therapy", dataType: "coded", requirement: "required"
  responseOptions: [{value: "not_given", ...}, {value: "given", ...}]
  visibilityCondition: null  (always visible)

Element B: response_to_neoadjuvant_therapy
  key: "response_to_neoadjuvant_therapy", dataType: "coded", requirement: "required"
  visibilityCondition: {"field":"neoadjuvant_therapy","op":"eq","value":"given"}
```

Trace:
```
Initial render: context = {} (no responses yet)
  -> evaluateCondition({field:"neoadjuvant_therapy",op:"eq",value:"given"}, {})
     -> context["neoadjuvant_therapy"] is undefined; undefined !== "given" -> false
  -> Element B is hidden. Element A renders (required, requirement met once answered).

User selects "Given" on Element A (neoadjuvant_therapy)
  -> local form state: responses = [{elementKey: "neoadjuvant_therapy", value: "given"}]
  -> context = {neoadjuvant_therapy: "given"}
  -> re-evaluate every element's visibilityCondition against the new context
  -> evaluateCondition({field:"neoadjuvant_therapy",op:"eq",value:"given"}, {neoadjuvant_therapy:"given"})
     -> "given" === "given" -> true
  -> Element B (response_to_neoadjuvant_therapy) becomes visible, rendered as a required field.

User enters a value for Element B (e.g. "complete_response")
  -> responses now includes both entries.

User submits.
  -> POST body: { orderedTestId, synopticProtocolVersionId,
                   responses: [{elementKey:"neoadjuvant_therapy",value:"given"},
                               {elementKey:"response_to_neoadjuvant_therapy",value:"complete_response"}] }
  -> Backend re-derives the identical context from `responses` (recorder.ts:158-159) and
     re-evaluates every required element's visibilityCondition itself (recorder.ts:161-178) --
     authoritative, never trusts the client's own hide/show decision.

Counter-case: user leaves Element A as "not_given" and never answers Element B.
  -> Client never renders Element B as an input (hidden), so no {elementKey:
     "response_to_neoadjuvant_therapy", ...} entry is ever added to `responses`.
  -> Backend: hidden = !evaluateCondition(B.visibilityCondition, {neoadjuvant_therapy:"not_given"})
             = !false = true -> B is correctly excluded from the missingRequired check even
     though it's `requirement: 'required'` -- submission succeeds with no error.
```

A second, independent real example confirming the same mechanism (`db/seed/synoptic-protocol-breast.sql:123-124`):
`her2_percent_membrane_staining` (quantity, recommended) has
`visibilityCondition: {"field":"her2_status","op":"eq","value":"positive_3plus"}` — becomes visible
only when the coded `her2_status` element is answered `"positive_3plus"` (HER2 IHC Score 3+),
exactly matching the real ICCR form's own greyed-out-unless-positive convention (per the seed
file's own header comment, cross-checked against the design partner's CAP template).

## 4. Skills loaded

- `frontend-design` (required — this feature adds new `apps/web` pages/forms). Entry #8 (a
  `'use server'` file may only export async functions — `types.ts` split enforced from the start,
  §2 file list above). Entry #6 (`DataTable`/function-prop Client Component boundary — not
  directly applicable, no `DataTable` used, but the same RSC boundary discipline applies to the
  protocol-form Client Component receiving the element tree as plain serializable JSON props, not
  functions). Entry #9/#10 (dynamic-segment naming) — `[partId]` is a genuinely new segment
  position (`cases/[caseId]/synoptic/[partId]`), not colliding with any existing route at that
  tree position (confirmed: no other route has a dynamic segment directly under
  `cases/[caseId]/synoptic/`).
- `api-design` — not required for new-route work (no new `apps/api` route is added), but entry #6
  (only mutating actions are audited) and entry #15 (`@Audit()`-wrapped return shape) were both
  re-checked against the existing `recordResponses()` route to confirm nothing here changes: it
  has no `@Audit()` decorator at all (writes its own audit event inside
  `assembleAndPersistSynopticResponse`, per that route's own header comment,
  synoptic-protocol.controller.ts:165-168) — so unlike #636/#639, there is no
  `AuditInterceptor`-wrapping surprise to account for on the frontend's `actions.ts` fetch; the
  response shape is exactly `SynopticResponseResult` (`packages/domain/src/synoptic-protocol.ts:97-102`),
  confirmed by reading the controller's real return statement, not assumed.

## 5. Assumptions & autonomous decisions

**5.1 — Move `evaluateCondition` into `packages/domain/src/conditions.ts`, don't duplicate it.**
The function (`apps/api/src/workflow/workflow-condition-evaluator.ts:9-58`) is pure, total, and
has zero dependencies beyond `ConditionNode`/`isConditionLeaf` — which already live in
`@lis/domain` (moved there for FEAT-047's report-designer preview, per that file's own header
comment: "so apps/web can validate a condition client-side against the same schema instance apps/api
enforces server-side"). The issue's own instruction said "port/mirror" the logic; this proposal's
own re-verification found the cleaner, already-established precedent is to finish the move FEAT-047
started halfway (it moved the *type*, not the *evaluator*) rather than hand-copy the function into
a second location that can drift. `apps/api`'s own existing spec
(`workflow-condition-evaluator.spec.ts`) continues to exercise the identical function via a
re-export, so no test coverage is lost or duplicated. Flagged as an assumption, not a §10
question, because it's a mechanical refactor with an existing direct precedent (the `ConditionNode`
move itself), not a new design call.

**5.2 — `orderedTestId` resolves to `orderedTests[0].id` on the case's own order.** The case's
order is created alongside the case (`case.controller.ts` `create()`) and — per every AP case
built this session — always carries at least the AP exam's own base ordered test. There is no
dedicated "AP exam" catalog entry distinguishing it from a reflex/add-on test added later via
issue #630's own per-block ordering UI; `orderedTests[0]` (lowest `createdAt`, i.e. the order's
original test) is the correct, unambiguous default for a case's own synoptic recording. If a case's
order genuinely has zero ordered tests (should not happen given case creation's own invariants,
but not impossible if a case was created against a malformed order via direct API access outside
this UI), the page shows an explicit error state rather than guessing (§8).

**5.3 — Response editing/re-recording: confirmed NOT supported by the existing API.** Independently
re-verified per the user's explicit instruction to confirm rather than assume: grepping
`synoptic-protocol.controller.ts` and `synoptic-response-recorder.ts` in full finds exactly one
write path, `POST` (create), no `PUT`/`PATCH` anywhere. This proposal does not add one. A second
`POST` for the same part/protocol with a different `orderedTestId` (impossible without a second
ordered test) or the same `orderedTestId` again would create a *second* set of discrete
observations plus a second grid observation — not update the first — since nothing in the recorder
checks for an existing response before inserting. To avoid this exact footgun, once a
`GET`-detectable "already recorded" signal exists (see §5.4), the UI must not let the user re-open
the form and re-submit; §5.4 covers how that's detected without a new backend route.

**5.4 — Detecting "already recorded" without a new GET route.** There is genuinely no route to
list a case's own previously-recorded synoptic responses (the issue's own explicitly-named
"report/document viewing" gap, out of scope here). This proposal does not add one either — adding
a read route to solve a UI nicety would expand this feature's own backend footprint, which the
issue explicitly forbids ("no schema or backend changes unless implementation uncovers a genuine
gap"). Instead: after a successful `POST`, the confirmation view (§8) is the only place a
just-recorded response is shown, sourced from that same response's own `SynopticResponseResult`
(`results: SynopticResponseResultEntry[]`) — not re-fetched. Navigating away and back to
`/cases/[caseId]/synoptic/[partId]` re-renders the empty form again (no memory of a prior
submission) — a user could technically double-submit by doing this. This is a real, named
limitation (not silently accepted) — see §6 Risks and §10 Q1 for whether it's acceptable for this
slice or needs a guard.

**5.5 — Protocol matching stays exact-string, matching `specimen.specimenType`'s and this
session's own #633/#642-research-pass precedent for this same known risk.** A part's
`specimenType` (free text) must exactly equal a published protocol's `specimenType` for the entry
link to appear. This inherits the same fragility #633's breadcrumb already named for
`requiresTwoTierReview()`'s own cytology match — not fixed here, per the issue's explicit "do not
expand into ... specimen-type cleanup."

**5.6 — Section grouping renders generically but exercises only depth-1 today.** See §3.2. Not
treated as a §10 question because the correct behavior (render whatever the data says, including
"no grouping") is unambiguous once the real seed data was checked directly.

## 6. Risks

- **Double-submission risk (§5.4):** since there is no existing-response check, a pathologist who
  navigates back to an already-recorded part's synoptic page and submits again creates a second,
  duplicate response set (two grid observations for the same order/protocol). This is a real,
  scoped-out gap this proposal does not fully close — flagged for explicit approval in §10 Q1,
  with a recommended mitigation that stays within "no new backend route."
- **`orderedTests[0]` heuristic (§5.2)** could bind synoptic responses to an unexpected ordered
  test on an order with multiple, unrelated tests (e.g. a case whose order also carries a reflex
  chemistry panel added later). Low real risk given this session's own AP case-creation pattern,
  but not a structural guarantee — named, not hidden.
- **Long-form usability (20–40+ fields):** Breast has 25 elements, Colorectal 26+. A single
  scrolling page with no pagination/wizard could be a poor experience. §7/§8 require this be
  verified as actually usable, not just "renders," before calling this done — see AC #7 and the
  Testing plan's own long-protocol usability check.
- **Client-side `evaluateCondition` divergence:** if `packages/domain`'s copy and `apps/api`'s
  (now re-exported) copy were ever to drift after this change (e.g. a future edit to one without
  the other), visible/hidden state on the client could silently disagree with the server's own
  authoritative check. Mitigated structurally by making them the literal same function (§5.1), not
  two copies — this risk only resurfaces if a future change reintroduces a fork.

## 7. Acceptance criteria

1. A case detail page shows a "Record synoptic protocol" link for each part whose `specimenType`
   exactly matches a published protocol's `specimenType`, gated `hasSpecimenManagementRole`.
2. Navigating to `/cases/[caseId]/synoptic/[partId]` renders the matched protocol's real element
   tree, grouped by `parentElementId` (today: one flat group, per §3.2), ordered by `displayOrder`,
   with `coded` elements as a `<select>` of `responseOptions`, `quantity` as a numeric input, `text`
   as a text input.
3. A `required` element with a `visibilityCondition` that evaluates false against the current
   in-progress answers is not rendered as an input, and is not submitted in the `responses` array.
4. Answering an element that another element's `visibilityCondition` depends on immediately shows
   or hides that dependent element, matching §3.3's worked trace exactly.
5. Submitting with a missing required (and visible) element, or an invalid coded value, surfaces
   the backend's own `400` message verbatim (same "plain error over client-side duplication"
   precedent #621/#624/#639 already established) — the client does not attempt to pre-validate
   beyond what live visibility already does.
6. A successful submission shows a confirmation view listing what was recorded (§5.4), and the
   response correctly appears (by reference) in `buildCaseReportContent()`'s own
   `synopticResponses` at the next `finalize`/`amend` on that case — proven by a real e2e assertion,
   not re-derived reasoning (§8).
7. The same generic renderer component correctly displays all three real seeded protocols
   end-to-end, including a long one (Breast/Colorectal, 25+ elements) usably (no broken layout,
   no missing elements, no infinite-scroll-with-no-landmarks problem) — confirmed live in a real
   browser, not just by code inspection.
8. RBAC: a session without `manage_specimens` (i.e. neither `technologist` nor `verifier`) does not
   see the entry link, and a direct-submission attempt against the route 403s (already guaranteed
   by the existing, unmodified backend route — confirmed by re-driving it, not just trusted).
9. Tenant isolation: a cross-tenant case id on the synoptic page 404s (matching `case.controller.ts`
   `getById()`'s own existing RLS-backed behavior — this page reuses that same fetch, no new
   isolation logic is introduced).

## 8. Testing plan

No `apps/api`/schema changes, so the entire existing `synoptic-protocol.e2e-spec.ts` and
`synoptic-response-recorder.spec.ts` suites stay the real backend proof of validation/RBAC/tenant
isolation/lifecycle-snapshot correctness — re-run unmodified as a regression check, not
re-authored. `workflow-condition-evaluator.spec.ts` re-run unmodified after the §5.1 move to
confirm the re-export preserves identical behavior (same test file, same assertions, new import
path only).

New coverage, mapped directly to the issue's own required list:

| Required scenario | How it's verified |
|---|---|
| Breast protocol rendering | Live browser: navigate to a Breast-eligible part's synoptic page, confirm all 25 elements render with correct input types and options (§3.2 tree). |
| Colorectal protocol rendering | Same, against a Colorectal-eligible part. |
| Cervical/Pap protocol rendering | Same, against a Pap-eligible part (smaller protocol — confirms the renderer isn't accidentally Breast/Colorectal-shape-specific). |
| Required-field validation | Submit with a required, currently-visible element left blank; confirm the backend's `400 Missing required element(s)` surfaces verbatim in the UI. |
| Conditional field visibility | Live-drive §3.3's exact worked trace: confirm `response_to_neoadjuvant_therapy` is absent from the DOM until `neoadjuvant_therapy` is set to `given`, then appears. |
| Hidden-field responses not incorrectly submitted | With `neoadjuvant_therapy` left at `not_given`, inspect the actual outgoing `POST` request body (`read_network_requests`) and confirm no `response_to_neoadjuvant_therapy` entry is present. |
| Invalid responses rejected by backend | Submit a request (via direct API call, bypassing the client's own `<select>` constraint) with an out-of-list coded value; confirm `400 Invalid response(s)`. |
| Correct `orderedTestId` association | After a real submission, query the created `observation` rows directly and confirm every one's `orderedTestId` matches `orderedTests[0].id` from the case's own order. |
| Successful persistence and reload behavior | After submission, reload `/cases/[caseId]/synoptic/[partId]` and confirm the page still functions (renders the empty form again per §5.4 — not a crash; explicitly checked as a *named* behavior, not assumed fine). |
| Correct interaction with finalize/report snapshot | Real e2e: record a synoptic response, finalize the case, confirm `case_report_version.includedContent.synopticResponses` contains the recorded observation id(s) via a direct query — reusing `case-sign-out.e2e-spec.ts`'s own query-and-assert style. |
| RBAC | A `qa`-role (no `manage_specimens`) session: confirm the entry link is absent from SSR HTML (direct `curl` with a minted session cookie, matching issue #639's own verification method) and a direct `POST` 403s. |
| Tenant isolation | A cross-tenant case id on the synoptic page URL 404s (matches existing `getById()` RLS behavior; single live check, no new isolation code to test). |
| Empty/error/loading states | No eligible protocol for a part → no entry link (not a broken link) confirmed by inspection; a part whose order has zero ordered tests (§5.2) → explicit error message, not a silent crash; a network/API failure on submit → error state matching this session's own established `state.status === 'error'` pattern (#630/#636/#639's own `useActionState` forms). |
| Browser refresh/navigation without losing already-saved state | Since responses are create-only with no draft-save (§5.4's own scope line), "losing state" specifically means: does a mid-form refresh lose in-progress *unsaved* answers? Yes, expected and named (no local persistence is proposed — would be new scope, not requested) — verified as a known, accepted limitation, not silently discovered later. What must NOT happen: a refresh after a *successful* submission must not allow a silent duplicate-looking resubmission without the user explicitly re-filling and re-clicking submit (i.e., no auto-resubmit, no stale form state bleeding into a new submission) — confirmed live. |
| Long protocols (20–40+ fields) remain usable | Live browser check on Breast (25 elements) and Colorectal (26+): page scrolls cleanly, every element is reachable and answerable, condition-triggered elements appearing/disappearing don't visually break surrounding layout, submit button remains reachable/visible. |

All live-browser checks use Claude-in-Chrome per this session's established `web-verify` pattern,
with the documented minted-session-cookie + direct-API-call fallback if the extension disconnects
mid-pass (as happened during #627/#630 this session).

## 9. Rollback plan

Purely additive: one new route tree (`/cases/[caseId]/synoptic/[partId]`), one new entry link on
the existing case detail page, and a mechanical (behavior-preserving) move of `evaluateCondition`
into `@lis/domain` with a re-export left in place at its old import path for every existing
`apps/api` caller. Revert is a plain `git revert` of the PR — no migration, no data written by this
feature that any other code depends on (the `observation`/audit/outbox writes are the existing
recorder's own behavior, already relied upon by FEAT-064's reflex rule regardless of whether this
UI exists).

## 10. Questions requiring human approval

All three resolved by explicit human walkthrough, 2026-08-20 — recommended defaults taken in every
case:

**Q1 — Double-submission guard (§5.4/§6). RESOLVED: ship without one for this slice.** The backend
already tolerates duplicate submissions without corrupting anything (each is a fully independent,
correctly-formed record); a real guard needs either a new GET route (reporting/viewing territory,
explicitly out of scope) or a client-only heuristic that can't be authoritative anyway. A future
"view previously recorded synoptic responses" feature (the report/document-viewing gap) is the
natural place to also add a "don't let me re-record" guard once that GET route exists.

**Q2 — Entry-link placement on the case detail page. RESOLVED: inline per-part, in the existing
tree.** "Record synoptic protocol" as the link text, one per eligible part, placed near each
part's own heading in the existing parts/blocks/slides tree — matches UploadWsiForm's own
nested-in-tree placement precedent (issue #627), not the page-level-card pattern used for
Amend/Sign out/Screen, since eligibility is per-part, not per-case.

**Q3 — Multiple published protocols matching one part's `specimenType`. RESOLVED: out of scope,
take the first match.** Not schema-enforced unique, but not reachable with any of the three real
seeded protocols (each has a distinct `specimenType`). If it ever occurs, the UI uses the first
match from `GET /v1/synoptic-protocols`'s own list order — not worth a protocol-picker UI for a
currently-unreachable case.
