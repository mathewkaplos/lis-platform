# Implementation Proposal: Synoptic response read path (issue #659)
Status: APPROVED
ADR: adr-0050 (synoptic protocols)    Date: 2026-08-20    Backlog ID: issue #659

## 1. Goal

A recorded synoptic protocol response (`POST /v1/cases/:id/synoptic-responses`)
has no read path today — confirmed absent at both layers during the
2026-08-20 AP architecture review
(https://claude.ai/code/artifact/684ca0a6-a210-4d86-8063-ec6adad91dcc, §4,
§6, §25): no `GET` route exists in `synoptic-protocol.controller.ts`, and
the case-detail page only ever renders the "Record synoptic protocol" entry
link, never fetches prior answers. A second visit to
`/cases/[caseId]/synoptic/[partId]` after a real submission shows a blank
form with no indication a response already exists.

Add a read path — a backend `GET` route plus a case-detail UI surface — so a
pathologist can see what's already been recorded without a direct database
query. This is a pure read: no change to the recorder, the response schema,
or how responses are written.

## 2. Affected files

- **New:** `GET /v1/cases/:id/synoptic-responses` route in
  `apps/api/src/case/case.controller.ts` (co-located with the existing
  `GET /v1/cases/:id/report-versions` read route, same controller, same
  pattern — not added to `synoptic-protocol.controller.ts`, since the
  natural query key is "responses recorded against this case," not "responses
  recorded against this protocol").
- **New:** a small query/assembly helper (mirrors
  `case-report-content-assembler.ts`'s separation-of-concerns precedent) —
  exact file TBD during implementation, likely
  `apps/api/src/case/case-synoptic-response-query.ts`.
- **Modify:** `packages/domain/src/synoptic-protocol.ts` — add a response
  type for the list route (reusing `synopticResponseResultSchema`'s existing
  shape, not inventing a parallel one).
- **Modify:** `apps/web/app/(app)/cases/[caseId]/page.tsx` — fetch the new
  route alongside the case's existing parallel fetches; render a read-only
  "recorded" summary per part that has one.
- **New (frontend):** a small presentational component for the recorded-
  response summary (exact file TBD — likely colocated with
  `protocol-form.tsx`'s directory, since it renders the same
  `SynopticElement` label/value shapes that file already knows how to
  format).
- **No migration.** No table/column changes — this reads existing
  `observation` rows.

## 3. Architecture consulted

- ADR-0050 (synoptic protocols are generic, versioned data) — the read path
  must stay protocol-agnostic, matching the recorder's own invariant of never
  branching on organ/protocol identity.
- `docs/plans/feat-058-generic-synoptic-protocol-engine.md` §8 — dual-emission
  write shape this route reads back.
- `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts` (read in
  full during this proposal's research) — **key finding that shapes this
  proposal's whole approach**: every recording already writes one `table`-
  dataType "grid" Observation per call, whose `valueJson` is
  `{ synopticProtocolVersionId, results: [{elementKey, elementLabel, value,
  observationId}, ...] }` — **exactly** the shape
  `packages/domain/src/synoptic-protocol.ts`'s existing
  `synopticResponseResultSchema` already describes (it's literally what the
  `POST` route returns synchronously today). This means the read path does
  **not** need to re-derive a response from N discrete Observations plus a
  join against `synoptic_element` for labels — it can just query the most
  recent `table`-dataType Observation per `orderedTestId` (keyed off the
  shared `ICCR-SYNOPTIC`/`synoptic-report-grid` analyte
  `synoptic-response-recorder.ts` already writes every grid row under) and
  return its `valueJson` almost as-is. Substantially smaller read path than
  originally assumed before reading the recorder.
- `apps/api/src/case/case.controller.ts`'s existing `GET /v1/cases/:id`
  handler — read in full for the RLS/404 convention (`engineering/api-design`
  entry #7: cross-tenant returns 404 via RLS structural invisibility, no
  application-level check) and the `report-versions` route's precedent for a
  case-scoped list route living on this controller rather than the synoptic
  one.
- `whole_slide_image`'s "most-recent-wins, no version chain" policy
  (ADR-0055, already proven in `GET /v1/cases/:id`'s own slide-lineage
  query) — the direct precedent this proposal reuses for "which response wins
  if a part has more than one recording" (see §5 Q1).

## 4. Skills loaded

- `anatomic-pathology-synoptic-engine` (new, written during the 2026-08-20
  review) — entries #4 (case-level rendering is hard-coded, informs keeping
  this route's output simple/reusable), #5 (synoptic Observations never
  reach `verified` — irrelevant to this read path specifically since it
  reads `preliminary` rows directly, but worth knowing why "most recent"
  rather than "verified" is the only sensible selection rule available),
  #6 (this exact gap, full context), #7 (verify-against-code discipline).
- `engineering/api-design` — required per the `plan` Skill's own rule (this
  adds a genuinely new `apps/api` route). Entry #6 (only mutating actions are
  audited — this is a plain `GET`, no `@Audit()`) and entry #7 (cross-tenant
  → 404, not 403) both apply directly.
- `engineering/frontend-design` — required per the `plan` Skill's own rule
  (this adds a new `apps/web` UI surface on an existing page). No entry here
  is directly triggered by a read-only presentational addition (no new
  Server Action, no new dynamic route segment, no client-only library) —
  noted as checked, not skipped.
- `engineering/database-design` — consulted for the query pattern (reading
  `observation` correctly, respecting its partitioned-by-`created_at` PK) —
  no schema change in this proposal, so most entries don't apply; confirmed
  by reading the table's own schema comments during research rather than
  assuming.

## 5. Assumptions & autonomous decisions

- **Route lives on `case.controller.ts`, not `synoptic-protocol.controller.ts`.**
  Matches the existing `report-versions` precedent (a case-scoped list of
  case-related records) rather than the protocol-scoped controller. Low risk,
  reversible.
- **Route returns all of a case's recorded responses in one call**
  (`GET /v1/cases/:id/synoptic-responses`), not one route per part. Matches
  how the case-detail page already fetches most of its data (one call per
  concept, not per part) and avoids N+1 requests from a multi-part case.
- **Selection rule for "the" response when the same protocol has been
  recorded more than once: most recent `table`-dataType grid Observation
  wins**, exactly mirroring `whole_slide_image`'s own already-proven
  "most-recent-ready-wins, no version chain" policy. This is a deliberate,
  narrow v1 scope boundary — real response versioning/supersession is issue
  #662's separate, larger concern; this proposal does not attempt to
  distinguish or reconcile multiple recordings beyond picking the latest.
- **Correction found during implementation, before any code was written:**
  responses are not actually part-scoped in the write path today —
  `orderedTestId` is resolved client-side as `order.orderedTests[0]?.id`,
  the same value regardless of which part's recording page is used
  (`synoptic/[partId]/page.tsx:80`), and the recorder never stores a
  `specimenId`/`partId` on the response at all. This read path therefore
  keys its "most recent wins" rule on **`(orderedTestId,
  synopticProtocolVersionId)`, not on part** — correct for the common case
  (one synoptic-eligible part per case, or eligible parts using different
  protocols), but if a case ever has two eligible parts recorded against the
  *same* protocol, this route cannot distinguish which part a given response
  belongs to, and will only ever surface the most recent one. Per human
  decision during implementation: this is a real, separate, pre-existing gap
  in the write path, not something this P0 read-only task expands to fix —
  tracked as its own follow-up issue (#674) rather than silently expanding
  this task's scope.
- **No new capability gate — plain `JwtAuthGuard`, matching every other read
  route on this controller** (`GET /v1/cases/:id`, `GET .../report-versions`,
  `GET .../report-versions/:versionId/pdf` are all ungated beyond auth; RLS is
  the real tenant boundary, and `engineering/api-design` entry #6 confirms
  this repo's convention of auditing only mutating actions). A synoptic
  response is exactly as sensitive as the case data already readable via
  `GET /v1/cases/:id` — no reason for a stricter gate here specifically.
- **No `@Audit()`** — plain read, matching entry #6 above and the sibling
  report-versions/pdf routes.
- **Frontend shows a read-only summary alongside the existing "Record
  synoptic protocol" entry link, not a replacement for it.** Re-recording
  remains the only write path (unchanged by this proposal); the link stays
  present and functional. This keeps the frontend change small and strictly
  additive, deferring "should recording again be blocked/warned-against
  once something exists" to issue #662.
- **Response value rendering reuses `protocol-form.tsx`'s existing
  label/value formatting knowledge** (it already knows how to render each
  `dataType`, including `coded_multi` arrays) rather than writing a second,
  parallel formatter.

## 6. Risks

- **A part's grid Observation may reference a `synoptic_protocol_version`
  whose elements have since changed** (a protocol version is immutable once
  published per ADR-0050, so this is low risk in practice, but worth stating
  explicitly): the stored `elementLabel` in the grid Observation's own
  `valueJson` is a point-in-time copy, so rendering from the grid Observation
  directly (rather than re-joining live `synoptic_element` rows) is actually
  the *safer* choice here — it shows what was true when recorded, not a
  potentially-drifted live re-join. No mitigation needed; noted as a design
  strength, not a gap.
- **Multiple grid Observations per part** (if a part was recorded more than
  once) means the "most recent wins" query must be written correctly (order
  by `producedAt`/`createdAt` descending, limit 1 per `orderedTestId`) — a
  real but small correctness risk, mitigated by a direct e2e test recording
  twice and asserting the read route returns the second recording.
- **Low risk overall** — additive, read-only, no schema change, no change to
  any existing write path.

## 7. Acceptance criteria

- A case with a recorded synoptic response on at least one part: the new
  route returns that response's recorded elements/values, correctly labeled,
  for every `dataType` currently supported (`coded`, `quantity`, `text`,
  `coded_multi` — array values render correctly).
- A case with no recorded responses: the route returns an empty result, not
  an error.
- A part recorded twice: the route returns only the most recent recording's
  values (proven by a real e2e test that records twice with different values
  and asserts the second recording's values are what's returned).
- Cross-tenant request for another tenant's case: `404`, not `403` (RLS,
  matching `GET /v1/cases/:id`'s own proven convention — assert this
  directly, don't assume it from the interceptor alone).
- The case-detail page shows a real "already recorded" summary for a part
  with a response, and shows no such summary (unchanged current behavior)
  for a part with none — verified in a real browser
  (`web-verify` Skill), not just via the API response shape.

## 8. Testing plan

- New `apps/api` e2e coverage in (or alongside) the existing
  `synoptic-protocol.e2e-spec.ts`: empty-case case, single-recording case,
  double-recording case (asserting most-recent-wins), cross-tenant 404.
- Full existing `apps/api` e2e suite run clean against a freshly reset local
  DB (this repo's standing verification bar for any AP change) — confirms no
  regression to the recorder or any other case route.
- Real browser pass (`web-verify` Skill) on the case-detail page: a case with
  a recorded response shows the summary; a case without one doesn't; values
  for each `dataType` (including a `coded_multi` array) render legibly.

## 9. Rollback plan

Purely additive (new route, new frontend read, no migration, no change to
any existing route or write path) — revert is a plain revert of this PR's
diff, no data migration or backfill involved either direction.

## 10. Questions requiring human approval

1. **Route shape and selection rule** — `GET /v1/cases/:id/synoptic-responses`
   returning all parts' most-recent recording in one call, with "most recent
   grid Observation wins" as the only reconciliation rule (no attempt at
   deeper versioning — that's issue #662). Recommended default; matches
   existing `report-versions`/WSI precedents.
2. **Frontend placement** — a read-only summary alongside the existing
   "Record synoptic protocol" link (not replacing it, not blocking
   re-recording). Recommended default; keeps this proposal's scope to
   "view," leaving any "should re-recording be discouraged/confirmed" UX
   decision to issue #662.
3. **No new capability gate** — plain `JwtAuthGuard`, matching every sibling
   read route on this controller. Recommended default.

If all three defaults are acceptable, approving this proposal as-is (no
further discussion needed) is sufficient to proceed.
