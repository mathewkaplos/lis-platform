# Implementation Proposal: Synoptic protocol response versioning (issue #662)
Status: APPROVED
ADR: adr-0007 (observation correction/version linkage)    Date: 2026-08-20    Backlog ID: issue #662

## 1. Goal

`POST /v1/cases/:id/synoptic-responses` is a pure create — recording a second
response for the same (orderedTestId, synopticProtocolVersionId) today
creates a second, unrelated set of Observations with no link to the first,
no indication which is authoritative, and no audit trail of the correction.
Add a real version chain so a re-recording is an explicit, queryable
amendment, not a silent orphaned duplicate.

## 2. Affected files

- **Modify:** `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts`
  — look up the current (non-superseded) predecessor grid Observation before
  inserting, and set `amendmentOf` on each new discrete Observation and the
  new grid Observation where a matching predecessor exists.
- **Modify:** `packages/domain/src/synoptic-protocol.ts` — add
  `amendmentOf: z.uuid().nullable()` to `synopticResponseResultSchema` and
  `caseSynopticResponseSchema` (issue #659's read route).
- **Modify:** `apps/api/src/case/case.controller.ts`'s
  `listSynopticResponses` (#659) — tighten the "most recent wins" selection
  to filter `supersededBy IS NULL` directly (the real chain head) instead of
  ordering by `createdAt` and taking the first per key — now that a real
  chain exists, this is strictly more correct, not just a heuristic.
- **Modify:** `apps/api/test/synoptic-protocol.e2e-spec.ts` — new coverage
  proving the amendment chain: record twice, confirm the old grid/discrete
  Observations are `supersededBy`-linked, the read route surfaces only the
  current head with `amendmentOf` pointing at the prior version, and the
  audit event's `after` payload includes the amendment link.

No migration — every column and trigger this reuses already exists and is
already proven (see §3).

## 3. Architecture consulted

- **ADR-0007** (read in full) — decided `amendment_of` (new→old, set by the
  application) and `superseded_by` (old→new, set automatically) as
  redundant, complementary pointers on `observation`, specifically so "give
  me the current value" (`superseded_by IS NULL`) and "what did this
  correct?" (`amendment_of`) are each a cheap, direct lookup.
- **`db/migrations/0007_observation_append_only_trigger.sql`** (read in
  full) — the real mechanism this proposal reuses, not just references:
  `fn_observation_supersede` (`AFTER INSERT ON observation`) fires whenever
  a new row's `amendment_of` is set, **unconditional on the predecessor's
  status** (verified or `preliminary` alike) — it atomically archives the
  predecessor's prior state into `result_history` and sets the predecessor's
  own `superseded_by` to the new row's id. **The application only ever needs
  to set `amendment_of` on the new insert; the trigger does the rest.** This
  directly resolves the risk the synoptic-engine Skill's entry #5 named
  (synoptic Observations never reach `verified`, so the *append-only*
  protection doesn't engage for them) — that finding is about a different
  trigger (`fn_observation_append_only`, which only blocks *mutation* of an
  already-`verified` row); the *supersede* trigger this proposal relies on
  is unconditional and already fires correctly regardless of status,
  confirmed by direct reading of its own SQL body, not assumed.
- **`db/migrations/0008_...` `fn_observation_link_created_at`** — the
  composite-PK companion column (`amendmentOfCreatedAt`, required because
  `observation`'s real PK is `(id, created_at)` per ADR-0008's partitioning)
  is auto-populated by its own trigger — confirmed via
  `observation.e2e-spec.ts`'s own existing direct-insert fixture, which sets
  only `amendmentOf` and never touches the companion column itself.
- `synoptic-response-recorder.ts` (already read in full during #659) — the
  grid Observation's own `valueJson.results` array already stores
  `{elementKey, observationId}` per element from the prior recording, which
  is exactly what's needed to build an `elementKey → predecessor
  observationId` map without any new query shape.
- Issue #659's own read route (`listSynopticResponses`) — already selects
  "most recent grid Observation per (orderedTestId, synopticProtocolVersionId)";
  this proposal tightens that to the provably-correct `supersededBy IS NULL`
  filter now that the chain is real.

## 4. Skills loaded

- `anatomic-pathology-synoptic-engine` — entry #5 (why synoptic Observations
  never reach `verified`) directly informed confirming the supersede
  trigger's unconditional behavior above, rather than assuming it might not
  apply.
- `engineering/api-design` — entry #6 (only mutating actions are audited —
  unchanged here, the existing `synoptic.record` `@Audit`-equivalent
  `writeAuditEvent` call is reused, just enriched); no new route added, so
  most other entries don't apply.
- `engineering/database-design` — consulted for the composite-PK/MATCH FULL
  FK convention this reuses (confirmed via direct schema read, not assumed).
- No `frontend-design` — no `apps/web` change in this proposal (the #659
  case-detail summary already renders whatever the read route returns;
  adding `amendmentOf` to the payload needs no UI change to keep working,
  and building a "view history" UI is explicitly out of scope per the
  issue's own text).

## 5. Assumptions & autonomous decisions

- **The real design question the issue names explicitly** — "does a
  re-recording silently replace the old one (draft-style, like
  `case_narrative`) or create a formal, audited version (like
  `case_report_version`)?" — is answered here as a **third, middle option**:
  a real, queryable `amendment_of`/`superseded_by` chain (not silent,
  unlike narrative), but **no required `reason` field, no elevated
  capability, no step-up** (still draft-time ergonomics, matching
  `manage_specimens`/no-step-up — appropriate because this is *pre-sign-out*
  working data; the actual legally-significant protection already happens
  at `buildCaseReportContent()`'s snapshot at sign-out time, which this
  proposal doesn't touch). Flagged explicitly in §10 for confirmation since
  the issue itself asks for a deliberate choice, not a default.
- **Chain key stays `(orderedTestId, synopticProtocolVersionId)`**, matching
  #659's existing selection key exactly — this proposal does not attempt to
  fix the separate, already-tracked part-scoping gap (issue #674).
- **An element present in an old recording but omitted from a new one has no
  forward link** — its old Observation simply stays permanently
  non-superseded (an orphaned-but-valid row, the same accepted shape this
  codebase already has elsewhere, e.g. audit rows outliving a deleted
  resource). Not a new problem this proposal introduces; not fixed here.
- **The existing `synoptic.record` audit event is reused and enriched**
  (`after.amendmentOf` added when applicable), not replaced with a new audit
  action type — matches the issue's own "no audit trail of the change"
  complaint directly without inventing a second audit action for what is
  still fundamentally the same operation (recording a response).

## 6. Risks

- **Low risk, purely additive to the write path.** No schema change, no new
  trigger, no new capability — reuses an already-built, already-tested DB
  mechanism (`fn_observation_supersede`) that has simply never had an
  application-level caller until now.
- If two recordings for the same key race concurrently, both could read the
  same "current" predecessor before either commits, and both would then
  legally chain onto it — the *second* commit's `amendment_of` insert would
  still succeed (the trigger's `WHERE superseded_by IS NULL` guard only
  prevents double-superseding via silently doing nothing to an
  already-superseded row, it doesn't reject the new insert itself), leaving
  two "amendments" of the same predecessor, one of which never actually got
  marked superseded. Real but low-probability (one technologist manually
  re-recording is not a high-concurrency path); not mitigated with a
  transaction-level lock in this proposal — flagged in §10 as a scope
  question, not silently ignored.

## 7. Acceptance criteria

- Recording a second response for the same (orderedTestId,
  synopticProtocolVersionId) results in: the new grid Observation's
  `amendmentOf` pointing at the prior grid Observation's id; the prior grid
  Observation's `supersededBy` set to the new one's id (confirmed via a
  direct DB read, not inferred from the API response); the same true for
  each discrete per-element Observation that existed in both recordings.
- The #659 read route returns only the current (non-superseded) response
  for that key, with `amendmentOf` populated pointing at the prior version's
  `tableObservationId`.
- The audit event for a re-recording includes the amendment link in its
  `after` payload.
- A first-ever recording (no predecessor) behaves exactly as before —
  `amendmentOf: null` throughout, matching existing (pre-this-proposal)
  behavior and existing e2e coverage unchanged.

## 8. Testing plan

- New e2e coverage in `synoptic-protocol.e2e-spec.ts`: record once, record
  again with a changed value, confirm via direct DB reads that both the grid
  and the affected discrete Observations are correctly chained
  (`amendmentOf`/`supersededBy`), confirm the read route surfaces only the
  current version with the correct `amendmentOf` link, confirm the audit
  event payload.
- Full existing `apps/api` e2e suite re-run clean against a freshly reset
  local DB (standing bar for any AP change) — in particular re-confirming
  the existing "record twice, most-recent-wins" test from #659 still passes
  under the new, now-provably-correct `supersededBy IS NULL` read filter.

## 9. Rollback plan

Additive only — no schema change, no new trigger, no capability change. A
plain revert of this PR's diff restores the pre-existing (silently
duplicating) behavior with no data migration needed in either direction;
any `amendmentOf`/`supersededBy` values already written by this feature
would simply stop being written by new recordings, not become invalid.

## 10. Questions requiring human approval

1. **The three-way versioning-model choice** — real chain via
   `amendment_of`/`superseded_by`, no reason/capability/step-up required
   (the recommended middle option, reasoned in §5). Confirm this over the
   two precedents the issue itself named (silent narrative-style replace, or
   formal case_report_version-style audited versioning).
2. **The race-condition edge case in §6** (two concurrent recordings both
   chaining onto the same predecessor) is left unmitigated in this
   proposal's scope — confirm this is acceptable given the low real-world
   concurrency of this specific write path, rather than adding a
   transaction-level lock now.

If both are acceptable, approving this proposal as-is is sufficient to
proceed.
