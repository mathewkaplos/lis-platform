# Implementation Proposal: FEAT-064 — Cytology reflex: ASC-US → HPV management
Status: APPROVED
ADR: none (issue's own framing: "a rule-set addition on an already-proven engine, no new architectural decision expected" — confirmed true by this proposal's own design, §5)
Date: 2026-08-13    Backlog ID: #543 (FEAT-064, depends on FEAT-062 #541, FEAT-030)

## 1. Goal

A guideline-based cytology management reflex — an ASC-US (Atypical Squamous Cells of Undetermined
Significance) Bethesda interpretation auto-creates a follow-on HPV OrderedTest on the same
specimen — as a **published rule against the existing reflex-cascade engine (FEAT-030)**, the third
proven instance after FEAT-030's own TSH→FT4 illustration and FEAT-052's culture→organism-ID
cascade. Per the issue's own explicit framing, this feature *configures* the engine, it does not
extend it — confirmed true below: `AddReflexTest` is reused completely unmodified.

Clinical basis for ASC-US → HPV triage: Perkins RB, Guido RS, Castle PE, et al., "2019 ASCCP
Risk-Based Management Consensus Guidelines for Abnormal Cervical Cancer Screening Tests and Cancer
Precursors," *J Low Genit Tract Dis.* 2020;24(2):102-131 — HPV testing (reflex or co-testing) is
the standard triage step following an ASC-US cytology result. Search results confirmed 2026-08-13
(not from training-data memory alone).

## 2. Affected files

- `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts` — `assembleAndPersistSynopticResponse`
  gains one new line: after its existing single audit-event write, emits a new `SynopticResponseRecorded`
  outbox event in the same transaction. Payload is `{ orderedTestId, ...context }` — `context` is the
  *exact* flat `Record<elementKey, value>` object the function already builds internally (line ~158,
  `Object.fromEntries(responseByKey)`) to evaluate `visibilityCondition`s; reused verbatim, no new
  computation. **Unconditional, every protocol, every call** — never branches on which protocol or
  which element was recorded (ADR-0050 §Decision 4's own "one writer for every protocol" invariant,
  preserved exactly: the emission is as protocol-agnostic as the function's existing audit-event
  write already is). Contrast `CultureGrowthDetected`, which is emitted conditionally
  (`if (result === 'growth')`) — that conditional emission is possible there because
  `CultureReadController` is itself discipline-specific; `assembleAndPersistSynopticResponse` is not
  and must stay that way, so filtering (`interpretation_category == 'asc_us'`) happens entirely in
  the rule's own `when`, not in the emission point.
- `apps/api/src/workflow/workflow-engine.service.ts` — `onModuleInit()` gains one new
  `outboxHandlers.register('SynopticResponseRecorded', ...)` line, same shape as the existing four
  registrations (`ObservationVerified`/`ObservationFinalized`/`SlaBreached`/`CultureGrowthDetected`).
- `apps/api/src/workflow/workflow-types.ts` — `ALLOWED_FIELDS` gains `'interpretation_category'`,
  folding this event's one genuinely new field into the existing flat allow-list — the same treatment
  `result` already got for `CultureGrowthDetected` (this file's own header comment documents this as
  the repeatable pattern, not a one-off).
- `packages/domain/src/synoptic-protocol.ts` — new `synopticResponseRecordedEventPayloadSchema`
  (`{ orderedTestId: uuid, [elementKey: string]: string | number }` via Zod `.catchall()` — the
  response entries are genuinely open-ended, protocol-defined keys, not a fixed field set, unlike
  `cultureGrowthDetectedEventPayloadSchema`'s own two fixed fields).
- `db/seed/synoptic-protocol-cytology-pap.sql` — new final section: seeds a real `HPV` `test_definition`
  (code `HPV`, display name citing the ASCCP 2019 guideline above), no `analyte` (HPV result-entry is
  out of this feature's own scope — same "CULT carries no analyte of its own" precedent
  `microbiology-catalog.sql` already established for the culture panel itself, as opposed to the
  reflex-created ORGID panel which does get one).
- `apps/api/test/cytology-reflex-hpv.e2e-spec.ts` (new) — proves both issue ACs against a real
  Postgres/Keycloak/`OutboxRelayService.tick()` pipeline, mirroring `culture-read.e2e-spec.ts`'s own
  "growth fires the published rule" test shape exactly (per the issue's own literal instruction:
  "fixture mirroring FEAT-052's reflex-cascade test shape").
- `~/work/lis-engineering/skills/engineering/workflow-engine/SKILL.md` — entry #12 gets a short
  addendum (not a new entry — same root cause, second manifestation) noting that an AP case's own
  order-level OrderedTest also has no `specimen_fulfillment` row through any real production code
  path (§5 below), affecting reflex triggering here the same way it already affects result-entry for
  issue #561.
- Issue #561 gets a comment cross-referencing this second manifestation (not a new issue — same root
  cause, tracked in one place).

No new command handler, no new table, no new capability, no new ADR, no seeded production
`workflow_definition` rule (matches every prior reflex feature's own precedent below).

## 3. Architecture consulted

- **KB-25 Workflow Engine** (already loaded in full this session for FEAT-060, re-consulted) —
  trigger → when → do model; a new discipline-specific *fact* gets a new outbox event type, not a
  new command, when the existing command (`AddReflexTest`) already does the right thing once given
  the right trigger.
- **KB-18 Cytology** (already loaded in full this session for FEAT-062, re-consulted) — names
  ASC-US → HPV as the reflex archetype directly.
- **`engineering/workflow-engine` Skill** (already loaded in full this session, 12 entries,
  re-consulted) — entry #4 (no-op, never throw, on any "cannot safely act" branch — `AddReflexTest`
  already does this, unchanged); entry #5 (`parent_ordered_test_id` is the sole reflex-lineage
  marker); entry #7 (`WorkflowCommandRegistry` vs. `OutboxHandlerRegistry` are different layers — this
  feature only touches the latter, registering a new event, never touching the command registry);
  entry #8 (precedent for adding a new outbox event when the existing one fires at the wrong moment
  or carries the wrong shape — directly on point: `ObservationVerified` never fires for a synoptic
  response at all, since `assembleAndPersistSynopticResponse` writes `status: 'preliminary'`
  Observations with no verify() call in this feature's own workflow, per FEAT-062's own
  `operational-reports.service.ts` header comment: "discrete synoptic Observations stay
  `status: 'preliminary'` forever"); entry #12 (fulfillment-table gap directly informs §5/§6 below).
- **`apps/api/src/culture-read/culture-read.controller.ts`** (`record()`, re-read in full) — the
  exact precedent for "a discipline-specific controller action conditionally emits a new outbox
  event type in the same transaction as its own write; a published rule (`on:` that event type)
  dispatches `AddReflexTest` unmodified." FEAT-064 follows this shape as closely as
  `assembleAndPersistSynopticResponse`'s own protocol-agnostic constraint allows (§2's own
  unconditional-vs-conditional distinction).
- **`apps/api/src/reflex/add-reflex-test.command.ts`** (re-read in full) — confirmed unmodified:
  idempotent (existing-reflex check), cycle/depth-guardrailed, resolves the parent's specimen via
  `specimen_fulfillment`, creates the new `ordered_test` (`status: 'received'`, `parentOrderedTestId`
  set) + its own `specimen_fulfillment` row, writes one `ordered_test.reflex_create` audit event.
- **`apps/api/src/workflow/workflow-engine.service.ts`** (re-read in full) — `onModuleInit()`'s own
  registration pattern; `handleEvent()`'s flat `context[node.field]` lookup (`workflow-condition-
  evaluator.ts`, re-read in full) is the reason the new event's payload must place every response
  entry at the **top level**, not nested under a `responses` sub-object — directly shapes §2's
  `{ orderedTestId, ...context }` payload design.
- **`apps/api/src/synoptic-protocol/synoptic-response-recorder.ts`** (re-read in full, FEAT-058) —
  confirmed the exact `context` variable already built for `visibilityCondition` evaluation is
  reusable verbatim as the new event's payload body; confirmed the function's existing single
  `writeAuditEvent` call is the precedent for "the writer emits its own event in the same
  transaction," now extended to an outbox event too.
- **`apps/api/test/cytology-pap.e2e-spec.ts`** (re-read in full) — **found a real, load-bearing gap
  while tracing the fixture**: `createCytologyCase()`'s own `orderedTestId` (the carrier for the Pap
  synoptic response) comes from `POST /v1/orders` directly, with no subsequent `POST /v1/specimens`
  call — meaning it has **no `specimen_fulfillment` row at all**. Confirmed by grep that
  `case.controller.ts` (the whole AP/`POST /v1/cases` flow) never inserts into `specimen_fulfillment`
  anywhere — only `specimen.controller.ts`'s own ordinary chemistry/haematology/microbiology
  `POST /v1/specimens` route does. This is the exact same root cause already filed as **issue #561**
  (`ObservationWriteService.loadWriteContext` / `engineering/workflow-engine` Skill entry #12's own
  "Real gap found while implementing this" — there for `block_fulfillment`, here for a case-level
  order's own missing `specimen_fulfillment`), just manifesting as a reflex-trigger blocker instead
  of a result-entry blocker: `AddReflexTest`'s own parent-specimen lookup would silently no-op
  against any AP-created case's order-level OrderedTest today, in production, not merely in a test
  fixture. §5/§10 Q1 addresses how this proposal handles it.
- **`apps/api/test/culture-read.e2e-spec.ts`** (re-read in full) — the exact test shape to mirror
  (`publishRule`/`archiveAnyPublished` helpers, `OutboxRelayService.tick()` direct invocation for
  deterministic delivery, a `'no result-triggering value'` case proving no reflex fires, a redelivery
  idempotency check) — issue #543's own literal instruction ("fixture mirroring FEAT-052's
  reflex-cascade test shape").
- **`db/seed/microbiology-catalog.sql`** (re-read in full) — the exact precedent for seeding a real,
  cited reflex-target `test_definition` with **no analyte** when result-entry for that target is out
  of the feature's own scope (`CULT`/`ORGID`'s own header comment).

## 4. Skills loaded

`engineering/workflow-engine` (full, 12 entries — already loaded this session, re-consulted).

## 5. Assumptions & autonomous decisions

- **`SynopticResponseRecorded` is emitted unconditionally, on every synoptic response of every
  protocol** (§2) — filtering happens entirely in the rule's own `when`, never in the emission point,
  preserving ADR-0050 §Decision 4's protocol-agnostic writer invariant. This is a real, deliberate
  divergence from `CultureGrowthDetected`'s own conditional-emission precedent, necessary because the
  two writers sit at different genericity levels (a discipline-specific controller vs. a
  protocol-agnostic shared function) — flagged explicitly rather than silently copying a pattern that
  doesn't actually fit.
- **The specimen_fulfillment gap (§3's own finding) is NOT fixed by this feature** — `AddReflexTest`
  stays completely unmodified (matching the issue's own explicit "configures, does not extend" framing
  and `engineering/workflow-engine` Skill entry #12's own "any future discipline... gets its own
  command, don't branch the existing handler" rule, which cuts the other way here: the *right* fix
  for a case-level order missing `specimen_fulfillment` is a real design decision for whichever
  future feature builds genuine AP result-entry against issue #561, not a small addition here). This
  proposal's own e2e test proves the reflex *mechanism* (event → rule → `AddReflexTest` → new
  `ordered_test`) using the same test-fixture workaround issue #561's own Skill entry already
  documents (`specimen_fulfillment` inserted directly), and documents the gap's second manifestation
  in both the Skill entry and a comment on issue #561 rather than silently working around it
  unremarked. See §10 Q1 for the explicit tradeoff this asks you to confirm.
- **No production `workflow_definition` rule is seeded** — matches FEAT-030/052/060's own unbroken
  precedent (confirmed via `grep` across `db/seed/`: no reflex rule has ever been seeded as default
  tenant data). A tenant configures its own rule via the existing, unmodified
  `POST /v1/workflow-definitions` admin API; this feature's own e2e test publishes its own rule
  fixture the identical way `culture-read.e2e-spec.ts` already does.
- **HPV `test_definition` gets no `analyte`** — matches `CULT`'s own precedent; entering/reporting an
  actual HPV result is a distinct, unscoped future feature, not named in issue #543's own ACs.
- **`interpretation_category` is the only new `ALLOWED_FIELDS` entry** — not every possible synoptic
  element key across every current or future protocol. A future guideline-reflex feature keyed off a
  different element (e.g., a margin-status-driven histology reflex) adds its own field when it ships,
  matching this file's own documented "fold the new event's genuinely new field in" convention rather
  than speculatively widening the allow-list now for keys no rule references yet.

## 6. Risks

- **The specimen_fulfillment gap (§3/§5) means a real production AP-created cytology case cannot
  actually receive this reflex today**, only a case whose order-level OrderedTest happens to have a
  `specimen_fulfillment` row through some other path — the same real limitation issue #561 already
  names for result-entry. This proposal ships the *mechanism*, cited and cross-referenced, not a false
  claim that a real end-to-end cytology case works untouched. Mitigated by explicit documentation in
  two places (Skill entry #12 addendum, issue #561 comment) so it is not rediscovered from scratch by
  a future feature.
- **`ALLOWED_FIELDS` as a single global flat list, not event-scoped**, means a rule authored against
  `SynopticResponseRecorded` could reference `interpretation_category` correctly, but a rule authored
  against a *different* event type could also technically reference it (and silently evaluate
  `undefined` at runtime rather than being rejected at publish time) — an accepted, already-documented
  tradeoff (`workflow-types.ts`'s own header comment), not a new risk this feature introduces.
- **The HPV `test_definition` is placeholder catalog content** (no design-partner-provided code),
  same `chemistry-catalog.sql`/`microbiology-catalog.sql`-style "PLACEHOLDER, NOT PARTNER DATA"
  framing — only the *clinical justification* for the reflex itself (ASCCP 2019) is a real, cited
  external source, not the internal test code `HPV` itself.

## 7. Acceptance criteria

Per issue #543's own 2 ACs:
- [ ] An ASC-US interpretation auto-creates an HPV OrderedTest on the existing specimen (fixture
  mirroring FEAT-052's reflex-cascade test shape) — proven via a real `POST /v1/cases/:id/
  synoptic-responses` call with `interpretation_category: 'asc_us'`, a real published rule, a real
  `OutboxRelayService.tick()`, and a resulting `ordered_test` row (`parentOrderedTestId` set,
  `testDefinitionId` = the seeded HPV test, `status: 'received'`) linked via `specimen_fulfillment`
  to the same specimen as the parent.
- [ ] The reflex rule is configurable metadata, not hardcoded logic — proven structurally: the rule
  is authored through the existing, generic `POST /v1/workflow-definitions` API (no new route, no new
  command, no code path specific to ASC-US or HPV anywhere in `apps/api/src`), the same proof shape
  FEAT-030/052/060 already established.

## 8. Testing plan

1. `case-tiering`-style unit coverage is not applicable here (no new pure function) — this feature's
   only new logic is the outbox emission (one line) and the `ALLOWED_FIELDS` addition (one entry),
   both exercised only meaningfully at the integration level.
2. `cytology-reflex-hpv.e2e-spec.ts`:
   - ASC-US fires the published rule → new HPV `ordered_test`, correct lineage, correct
     `specimen_fulfillment` (using the same direct-insert workaround `image-attachment`/FEAT-060's
     own test fixtures already use for this exact gap).
   - NILM (or any other non-`asc_us` category) records successfully but creates **no** reflex — no
     `ordered_test` with that `parentOrderedTestId` after a `tick()`.
   - Redelivery idempotency (reset the outbox event to `pending`, `tick()` again, assert still
     exactly one reflex row) — `AddReflexTest`'s own existing guarantee, exercised through this
     feature's own real event, matching `culture-read.e2e-spec.ts`'s own precedent.
   - A rule published against `SynopticResponseRecorded` with `when: {field: 'interpretation_category',
     ...}` is accepted at publish time (proves the `ALLOWED_FIELDS` addition took effect) — implicitly
     covered by the ASC-US test itself succeeding at all (publish would 400 otherwise).
3. Re-run `cytology-pap.e2e-spec.ts` and `synoptic-protocol.e2e-spec.ts` unmodified as regression
   checks — the new unconditional outbox emission inside `assembleAndPersistSynopticResponse` must
   not break any existing synoptic-response test (confirmed by grep: no existing test asserts
   `outbox_event` row counts around any synoptic-response call today).
4. Full local verification: fresh `db-reset` → new file in isolation → RLS check (no new tenant-scoped
   table this feature, so no new fixture expected) → one final fresh-reset + full-suite run, this
   session's own established discipline.
5. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Every change here is additive: a new outbox event type nobody subscribed to before, one new
allow-listed field, one new seeded `test_definition` row, one new event registration. Reverting the
PR removes all of it cleanly; no existing behavior depends on any of it (no existing rule references
`SynopticResponseRecorded` or `interpretation_category`, since none could have been published before
this change — `ALLOWED_FIELDS` would have rejected it).

## 10. Questions requiring human approval

1. **Ship the reflex mechanism now, using the same test-fixture `specimen_fulfillment` workaround
   issue #561 already established, and document (not fix) the underlying gap** (Recommended, §5/§6)
   — versus first fixing issue #561 properly (giving `case.controller.ts`'s own AP flow a real
   `specimen_fulfillment`-equivalent linkage) so this reflex genuinely works against a production
   AP-created case, a materially larger change than this issue's own ~2-day estimate and explicitly
   out of this issue's own stated scope ("configures, does not extend" the engine).
2. **`SynopticResponseRecorded` is emitted unconditionally on every synoptic response of every
   protocol**, with filtering entirely in the rule's `when` (Recommended, §2/§5, preserves ADR-0050's
   protocol-agnostic-writer invariant) — versus adding a narrow, protocol-aware conditional emission
   (e.g., only for the cytology protocol specifically), which would reintroduce exactly the kind of
   organ/protocol branching ADR-0050 deliberately eliminated from this writer.
3. **`interpretation_category` is the only new `ALLOWED_FIELDS` entry**, added one-at-a-time per
   future rule the same way `result` was for `CultureGrowthDetected` (Recommended, §5) — versus
   widening the allow-list now to admit every current synoptic element key across breast/colorectal/
   cytology speculatively, ahead of any rule actually needing them.

**Do not begin implementation until Status above is changed to APPROVED.**
