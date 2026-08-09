# Status — 2026-08-09 (session 29, continued)

Last commit on main: `9dbd8ab` (`lis-platform`) / `bac2ab0` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M6 — "Automate": FEAT-026, FEAT-028, FEAT-029 shipped; FEAT-027 partially shipped; all one session

Session started with a full `/orient`. M5 confirmed fully closed (19/19 issues); M6 confirmed open
(7 issues: EPIC-005 + 6 features, all "Not Started" at session start). By end of session: FEAT-026
(#35), FEAT-028 (#37) closed; FEAT-029 (#38) shipped but deliberately left open (AC #2 deferred,
see below); FEAT-027 (#36) shipped a protocol-agnostic skeleton only, stays open, blocked on a
real-world fact. FEAT-030 (#39, Reflex rules) and FEAT-031 (#40, Auto-verification) remain
"Not Started" — natural next M6 work, see below.

### FEAT-026 (Edge integration gateway) — fully shipped, issue #35 closed

The gateway skeleton per KB-29 (`apps/gateway`: `POST /ingest` common ingestion port, a file-backed
store-and-forward queue, a forwarder authenticating via Keycloak client-credentials — **ADR-0026**),
plus a matching `apps/api` internal endpoint. Deliberately narrow — no Observation writing yet (that
became FEAT-027's job). Merged PR #428. `infra/keycloak/lis-realm.json` gained the `lis-gateway`
client + `gateway-ingest` role. `apps/gateway/Dockerfile` verified locally: builds, runs standalone.

**Not done, needs a human:** real on-prem/edge infra provisioning (Tailscale/OpenTofu edge node) —
a real, billable `tofu apply`, outside this session's autonomy boundary. The Dockerfile is the
artifact a human deploys once that infra exists.

### Issue #260 closed (pre-existing `observation` FK gap, flagged as FEAT-027's prerequisite)

`observation.ordered_test_id`/`specimen_id` now carry real Postgres FK constraints (migration
`0025`), backfilling ADR-0005's own already-decided, previously-unmet acceptance criteria. Grepped
every `.insert(observation)` call site first (`database-design` Skill entry #4's rule) — nothing
needed to change in any caller. New e2e tests prove Postgres actually rejects a bad id (23503).
Merged PR #431.

### `domain/analyzer-integration` Skill drafted (lis-engineering, already merged to main)

From FEAT-026's real findings: the common raw-result shape, the shared idempotency-key helper, the
M2M auth pattern for future machine callers, why the queue stays dependency-free, that it doesn't
overlap with the still-unbuilt FEAT-028 outbox, and that #260 (above) is closed.

### FEAT-027 (Analyzer #1 driver + idempotent ingestion) — partially shipped, issue #36 stays open

Human confirmed mid-session: the design partner's real instrument isn't known yet (no file in either
repo names it). Proposal narrowed accordingly — same pattern FEAT-026 used — to the real,
protocol-independent infrastructure a driver needs, with real ASTM/HL7 parsing explicitly deferred.
Merged PR #434:

- **ADR-0027**: extracted `ObservationController`'s private write-path methods
  (`loadWriteContext`/`resolveRangeAndFlags`/`upsertObservation`) into a new injectable
  `ObservationWriteService`, reused by both the human controller and analyzer ingestion — so an
  analyzer result gets identical range/delta/critical treatment to a human-typed one. Verified
  behavior-preserving: full e2e suite passed unchanged immediately after the extraction, before any
  new FEAT-027 code landed on top.
- New `instrument_analyte_mapping` table (versioned draft/published/archived, tenant-scoped) +
  `AnalyzerCorrelationService` (accession barcode → specimen → specimen_fulfillment → ordered_test →
  test_analyte match) + a minimal `conversionFactor` multiply (no unit-conversion engine exists
  anywhere in this codebase — confirmed by grep, not assumed).
- Real, DB-enforced dedupe via a new `observation_idempotency_key` table — **deliberately separate
  from `observation` itself**, found the hard way (a migration failed against the real DB, not
  caught by `drizzle-kit generate` alone): Postgres requires every unique index on a partitioned
  table to include the partition key (`created_at`, ADR-0008), which would let two genuinely
  duplicate writes both insert if placed directly on `observation`.
- `gateway-ingest` rewritten: dedupe-check → correlate → write via `ObservationWriteService`, status
  `registered` (same as a human draft — no auto-verification exists yet, FEAT-031 still "Not
  Started"). Unmatched results return 422 via a new `UnmatchedResultException` (+ a
  `ProblemDetailsFilter` branch, mirroring `PanelHoldException`'s pattern — a bare `HttpException`'s
  custom payload is otherwise silently discarded, found the hard way in an early test run). No
  forwarder change needed — `ForwarderService` already retries any non-2xx response, satisfying
  KB-29's "park, never drop" for free.
- Issue #36 commented, deliberately **not** closed — what shipped is the skeleton; the real
  ASTM/HL7 protocol driver for the actual instrument is still unbuilt, blocked on knowing what that
  instrument is.

### Issue #433 closed (`LocalQueueService` FIFO flake) — merged PR #437

`Date.now()` alone (millisecond resolution) let two `enqueue()` calls in the same millisecond sort
by their random UUID suffix instead of call order. First surfaced as a real, blocking CI failure on
FEAT-028's own PR #436 (`build-and-test` failing on `apps/gateway`'s suite), not found proactively.
Fixed with a monotonic in-process counter between the timestamp and UUID; new deterministic test
uses `vi.spyOn(Date, 'now')` (the previous test relied on real timing, which is exactly why the bug
was intermittent, not caught earlier). Merged as its own branch/PR, then merged into FEAT-028's
branch before that PR's own CI re-ran.

### FEAT-028 (Transactional outbox + event bus) — fully shipped, issue #37 closed, merged PR #436

**ADR-0028**: `outbox_event` table (written in the same transaction as the domain change it
describes) + `OutboxRelayService`, an `@Interval`-polling relay reusing `CriticalNotificationEscalationService`'s
own already-proven two-phase shape (ADR-0017: `lis_scheduler`/column-scoped-GRANT enumeration →
per-tenant `lis_app` processing). `writeOutboxEvent()` wired into `observation.controller.ts`'s
`verify()` — the first real emitter, one `ObservationVerified` event per verification, in the same
transaction as the status update. `OutboxHandlerRegistry` ships intentionally empty (a plain
in-process `Map`), for a future feature to register real handlers against.

- **Real bug found and fixed**: `enumerateTenantsWithPendingEvents()` originally filtered explicitly
  on `.where(eq(status, 'pending'))`, which failed `permission denied for table` for `lis_scheduler`
  — Postgres requires a column-scoped-GRANT role to hold its own grant on any column its own query
  text references, even when an RLS policy already restricts on that column using the table owner's
  rights. Fixed by removing the explicit filter, relying purely on the RLS policy (matching
  `CriticalNotificationEscalationService`'s own correct pattern). Documented as `database-design`
  Skill entry #13 (lis-engineering).
- `scheduler-db.ts` relocated from `critical-notification/` to `auth/` — a shared, cross-feature
  concern now, not owned by one feature.

### FEAT-029 (Metadata workflow engine) — shipped, issue #38 deliberately stays open, merged PR #438

**ADR-0029**: a fixed JSON-tree condition evaluator (`{and|or|not}` over `{field, op, value}`
leaves) — deliberately *not* a parsed string DSL, no `eval`/`Function`, safe by construction, with an
explicit field allow-list enforced at publish time. Scope narrowed to tenant-only (not
tenant+discipline) per the proposal. `workflow_definition`/`workflow_rule_firing` schema (migration
`0028`), a publish-time denylist guardrail validator (rejects `VerifyObservation` outright regardless
of a rule's own condition — not a general static analyzer), and `WorkflowEngineService` — the first
real `OutboxHandlerRegistry` consumer, registering itself for `ObservationVerified`, evaluating every
published rule (matched or not) and recording each firing to `workflow_rule_firing` for full
traceability. Gated by a new `manage_workflow` capability (`qa` role only).

- Scope deliberately narrowed to **engine-mechanism-only**: AC #2 (migrating the app's existing
  hard-coded workflows — critical-notification creation, delta-check flagging, etc. — onto this
  engine) is explicitly **not attempted**, per a posted issue #38 comment. This is why #38 stays
  open despite the mechanism itself being fully shipped and tested.
- **Real bug found and fixed**: `OutboxRelayService.processForTenant()` (FEAT-028) wrapped its whole
  per-tenant loop — read pending, invoke handlers, write status — in one `db.transaction()` on the
  app's singleton pool. Harmless while no handler existed; `WorkflowEngineService` is the first real
  one, and its own `handleEvent()` deliberately opens a *separate* `db.transaction()` on that same
  pool (by design — workflow evaluation isn't meant to be atomic with the relay's own delivery
  bookkeeping). Calling that handler from inside the relay's still-open transaction deadlocks —
  deterministic under this repo's own `DB_POOL_MAX=1` e2e config, and a real starvation risk under
  any pool size in production. Fixed by splitting into three short, sequential transactions (select
  pending / mark processed / mark failed), so no handler ever runs while a connection is held open.
  Documented as `database-design` Skill entry #14 (lis-engineering) — found via a deterministic
  5000ms timeout on both the new `workflow.e2e-spec.ts` and the pre-existing `outbox.e2e-spec.ts`'s
  own relay tests (a leftover pending `ObservationVerified` row from an earlier test was enough to
  trigger it once *any* handler existed for that event type).
- `ProblemDetailsFilter` custom-field-drop gap recurred (same shape as FEAT-027's
  `UnmatchedResultException` finding): the publish guardrail's rejection was originally a
  `{message, errors}` object, silently reduced to `.message` by the filter's generic branch. Fixed
  by using a plain string message instead (joined error list), read into `problem.detail` — no new
  filter branch needed since this didn't warrant dedicated structured fields.
- 4 new e2e tests: 403 for non-qa, 400 for a denylisted-command publish, a real rule evaluated
  against a real `ObservationVerified` event (matched and non-matched rules both recorded), RLS
  isolation.

**Found and filed along the way this session, not fixed (all pre-existing, unrelated, confirmed by
testing against unmodified code before attributing them to this session's changes):**
- Issue #427 — `lis-engineering/retrospectives/` has only `M0-retrospective.md` despite M1-M5 all
  closed. Still open, deferred, human's call.
- Issue #430 — `rls-isolation-check.ts` fails deterministically on a clean `db-reset` (`report:
  tenant A has 0 rows`), reproduces on `main` from before this session too. Still open, not CI-wired.

**Also this session:** hit and fixed, for real, the exact vitest/esbuild `design:paramtypes` gap
`engineering/testing` Skill entry #6 already documents (constructor-DI + metatype-DTO-validation
instances, recurring across FEAT-027/028/029's own new code) — caught via real e2e tests before
merge each time. No Skill update needed; it already covered and correctly predicted every instance.

**Carried into next session:**
- FEAT-027's real completion is blocked on identifying the design partner's actual instrument
  (protocol: ASTM vs HL7, vendor/model) — a real-world fact, not something derivable from either
  repo. Once known: write the real protocol driver, decide whether more unit conversion is needed
  than the current minimal multiply, and draft `domain/hl7-v2` only if the instrument turns out to
  speak HL7 (not drafted speculatively, same discipline `domain/analyzer-integration` followed).
- Issue #38 (FEAT-029) stays open by design — AC #2 (migrating existing hard-coded workflows onto
  the engine) is unstarted; a future feature's job, not a defect in what shipped.
- Issues #427, #430 remain open, both deferred/filed earlier this session, untouched since.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` needs a human's `tofu apply`.
- Carried from session 28, still not done by a human: a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges
  read clearly at a glance.

**Next session:** with FEAT-026/028/029 all closed-or-shipped and FEAT-027 blocked on an external
fact, the two candidates that can proceed independently are **FEAT-030 (Reflex rules, #39)** and
**FEAT-031 (Auto-verification, deny-by-default, #40)** — both "Not Started," both natural next M6
work, and FEAT-030 in particular may turn out to be a first real consumer of FEAT-029's
`WorkflowCommandRegistry` (currently empty) worth checking during that feature's own planning pass
rather than assuming. If the design partner has responded by then, FEAT-027's real driver work
takes priority over either.
