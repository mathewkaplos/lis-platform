# Implementation Proposal: FEAT-029 — Metadata workflow engine
Status: APPROVED
ADR: adr-0029 (safe expression evaluator + guardrail validator design — see §10)
Date: 2026-08-09    Backlog ID: FEAT-029 (issue #38)

## 1. Goal

Issue #38's own AC #2 — "existing Chemistry/Haematology hard-coded workflows are correctly
migrated to the engine with no behavior change" — is a much larger and riskier claim than this
proposal can responsibly deliver in one pass, and **this is flagged prominently, not quietly
narrowed the way FEAT-026/027's scope gaps were.** Those features narrowed against an *unbuilt*
target (a real instrument, a real event consumer). This one is different in kind: the "existing
hard-coded workflows" it names are Constitution-adjacent clinical logic already in production use
(critical detection, delta check, calculated-field cascading), and KB-25 itself leaves the DSL
surface — the exact mechanism this proposal must invent — as an explicitly unresolved open
question ("the exact predicate/field set exposed to `when`, and how it is extended safely").
Re-platforming already-shipped clinical logic onto a brand-new, unproven mechanism, in the same
pass that mechanism is first built, is a real patient-safety risk this proposal declines to take
on without an explicit, separate human decision — see §10 Q1.

This proposal's actual scope: build the engine mechanism itself (definition schema/versioning,
a safe declarative condition evaluator, publish-time guardrail validation, execution wired to
FEAT-028's outbox) and prove it end-to-end with **zero real command handlers** — a fired rule with
no registered handler is recorded (audit-adjacent) and logged, exactly mirroring how FEAT-028's own
`OutboxHandlerRegistry` shipped with one trivial logging handler rather than inventing real
consumer logic ahead of FEAT-029/030/031's own scope. FEAT-030 (reflex) and FEAT-031
(auto-verification) register their own real command handlers against this engine later — matching
the epic's own stated dependency order (FEAT-029 → FEAT-030 → FEAT-031).

## 2. Affected files

- `packages/db/src/schema/workflow-definition.ts` — new `workflow_definition` table, tenant-scoped,
  RLS'd: `id`, `tenantId`, `version` (int), `status` (`draft`/`in_review`/`published`/`archived`),
  `rules` (jsonb — array of `{id, on, when, do}`), `createdAt`. Partial unique index: at most one
  `published` row per tenant (see §5 on the deliberately narrowed `(tenant)`-only scope, not
  KB-25's own `(tenant, discipline)`).
- New `apps/api/src/workflow/` module: `workflow-definition.service.ts` (publish-time guardrail
  validation, `packages/db` CRUD), `workflow-condition-evaluator.ts` (the safe declarative
  evaluator — see §5/ADR-0029), `workflow-engine.service.ts` (registers itself as an
  `ObservationVerified` handler in `OutboxHandlerRegistry`, evaluates rules, dispatches to a
  `WorkflowCommandRegistry` that starts empty).
- New `workflow_rule_firing` table (tenant-scoped, RLS'd) — KB-25's own explicit requirement
  ("record the rule firing... to the audit trail — every automated action is as traceable as a
  human one"): `id`, `tenantId`, `workflowDefinitionId`, `ruleId`, `eventType`, `matched` (boolean),
  `command` (text, nullable), `dispatched` (boolean), `createdAt`.
- API endpoints: `POST /v1/workflow-definitions` (create draft), `POST
  /v1/workflow-definitions/:id/publish` (runs the guardrail validator, archives the prior published
  version), `GET /v1/workflow-definitions` (list, any status).
- No calculated-fields/delta-check/critical-detection code is touched or migrated — see §10 Q1.

## 3. Architecture consulted

- **KB-25 Workflow Engine** — the whole document; its own "Open questions" section (DSL surface,
  rule authoring governance) is read as a real signal this is intentionally unresolved
  architecture, not an oversight this proposal must fully close.
- **Constitution** (all five invariants) — guardrail validator §5.
- **`domain/critical-values` Skill entry #4** — "no event bus exists ahead of FEAT-028"; that
  caveat is gone (FEAT-028 shipped), but this proposal still does not build the
  `CriticalValueDetected` producer or any critical-adjacent rule logic — out of scope, same
  reasoning as FEAT-028's own single-producer narrowing.
- `apps/api/src/outbox/` (FEAT-028) — the `OutboxHandlerRegistry`/`OutboxRelayService` pattern this
  feature's own execution model directly reuses (register a handler, get delivered events).
- `apps/api/src/observation/observation.controller.ts`'s `maybeComputeDependents` — read as the one
  piece of genuinely workflow-shaped ("when X finalizes, compute/write Y") hard-coded logic that
  exists in this repo today; **not migrated by this proposal** (§10 Q1), but the closest real
  candidate for a future migration once this engine is proven.

## 4. Skills loaded

- `engineering/workflow-engine` — **does not exist yet**. Not drafted speculatively, same
  discipline `domain/analyzer-integration`/`domain/hl7-v2` already followed this session: draft it
  after this feature's real shape is proven, not ahead of any code.
- `engineering/database-design`, `engineering/testing` — entries #2/#4/#5/#13 as usual.

## 5. Assumptions & autonomous decisions

- **The condition evaluator is a fixed-shape JSON tree, not a string DSL.** `when` is
  `{"and"|"or"|"not": [...]}` composed of leaf comparisons `{"field", "op", "value"}` — `op` limited
  to `eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`/`includes`, `field` limited to an explicit allow-list read
  from the triggering event's own payload only (no catalog lookups, no cross-table reads during
  evaluation). This is a **conservative resolution of KB-25's own explicitly-open "DSL surface"
  question** (§10 Q2) — a plain JSON structure has no parser to get wrong and no eval/Function
  capability to sandbox, trivially satisfying "no I/O, no loops, no unbounded recursion" by
  construction, at the cost of being less expressive than a real predicate language. Extending the
  allow-listed field set or op set is a real, reviewable, future decision, not built speculatively
  now.
- **`workflow_definition` is scoped `(tenant)`, not KB-25's own `(tenant, discipline)`** — the
  `ObservationVerified` payload (`toObservationDto`) carries no discipline field today, and adding
  one is its own real decision (which table owns "discipline," how it's derived) this proposal
  declines to make speculatively. All of a tenant's published rules evaluate against every
  `ObservationVerified` event regardless of discipline this phase; per-discipline rule sets are a
  real, deferred narrowing.
- **Zero real command handlers.** `WorkflowCommandRegistry` starts empty, exactly like
  `OutboxHandlerRegistry` did in FEAT-028. A rule that matches and names a `do.command` with no
  registered handler is recorded in `workflow_rule_firing` (`matched: true, dispatched: false`) and
  logged — proving real rule evaluation and audit-adjacent traceability without executing anything.
- **Publish-time guardrail validator maintains an explicit denylist**, not a general static
  analyzer: `VerifyObservation` (and any other auto-verify-shaped command name) is rejected
  outright at publish time, full stop, regardless of the rule's own `when` — not "rejected unless
  the condition provably excludes criticals" (KB-25's own eventual target, needing real static
  analysis of the condition tree this proposal does not attempt). FEAT-031 is the feature that
  earns the right to register that command and correspondingly relax this validator, with its own
  proposal/ADR.

## 6. Risks

- The evaluator's allow-listed field set is necessarily small this phase (whatever
  `toObservationDto` exposes) — a real reflex/auto-verify rule (FEAT-030/031) will likely need
  fields this proposal's evaluator doesn't yet expose (prior verified value, patient age/sex, QC
  status). Extending the allow-list is expected, ordinary follow-on work, not a redesign.
- `workflow_rule_firing` grows unbounded with no retention policy — acceptable at this scale
  (matches this repo's own repeated "don't build ahead of a real need" precedent), revisit if
  volume ever becomes real.
- The denylist-based guardrail validator is a blunt instrument (rejects a command name outright,
  not "unsafe uses" of it) — deliberately so, given no real command exists yet to need finer
  granularity; FEAT-031 should re-examine this validator's own design, not just add itself to an
  allowlist, when it actually registers `VerifyObservation`.

## 7. Acceptance criteria

(narrowed from issue #38's own two — see §1/§10 Q1 for why AC #2 is not attempted here)

- [ ] A published `workflow_definition`'s rules are evaluated against every real
      `ObservationVerified` event for that tenant — proving "a new workflow rule can be added via
      configuration without a code deployment" (issue #38's AC #1) for the one event this phase
      wires up.
- [ ] The publish-time guardrail validator rejects a rule naming a denylisted command, and this is
      enforced before a definition can ever reach `published` status.
- [ ] Every rule evaluation (matched or not) that fires is recorded in `workflow_rule_firing`.
- [ ] RLS isolation test added for both new tables.

## 8. Testing plan

- Unit tests: the condition evaluator (`and`/`or`/`not` composition, each `op`, an unknown/
  non-allow-listed field rejected at validation time not evaluation time), the guardrail validator
  (denylisted command rejected, an ordinary command accepted).
- e2e: a real published definition with a rule matching a real `ObservationVerified` payload shape
  (e.g. `flags includes 'HH'`) — confirm `workflow_rule_firing` records the match after a real
  `POST .../verify` call, mirroring `outbox.e2e-spec.ts`'s own real-event-through-real-pipeline
  style. A second definition whose rule doesn't match confirms `matched: false` is also recorded,
  not silently skipped. A publish attempt with a denylisted command confirms 400/rejection.
- RLS isolation tests for both new tables.

## 9. Rollback plan

New tables + a new outbox handler registration, zero changes to any existing write path (unlike
FEAT-027/ADR-0027's refactor). Reversible via `DROP TABLE` + removing the handler registration.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

1. **AC #2's real scope — RESOLVED: defer entirely.** This proposal builds the engine mechanism
   only; nothing existing is migrated. Issue #38's AC #2 stays open, explicitly deferred to its own
   future task/proposal once this mechanism has been reviewed and proven in real use —
   `maybeComputeDependents` (calculated-field cascading) is the recommended first real migration
   candidate whenever that's picked up, given it's the closest existing analog to a workflow rule.
2. **The JSON-tree condition evaluator (§5) — RESOLVED: approved as proposed.** Written up as
   **ADR-0029**.
3. **`(tenant)`-only scope, not `(tenant, discipline)` (§5) — RESOLVED: approved**, folded into
   ADR-0029 as part of the same decision record.
