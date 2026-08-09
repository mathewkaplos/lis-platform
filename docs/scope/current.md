# Status — 2026-08-09 (session 29, continued)

Last commit on main: `a010332` (`lis-platform`) / `3f88afb` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M6 — "Automate": FEAT-026 kicked off and shipped, FEAT-027 partially shipped, all same session

Session started with a full `/orient`. M5 confirmed fully closed (19/19 issues); M6 confirmed open
(7 issues: EPIC-005 + 6 features, all "Not Started" at session start).

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

**Found and filed along the way this session, not fixed (all pre-existing, unrelated, confirmed by
testing against unmodified code before attributing them to this session's changes):**
- Issue #427 — `lis-engineering/retrospectives/` has only `M0-retrospective.md` despite M1-M5 all
  closed. Deferred, human's call.
- Issue #430 — `rls-isolation-check.ts` fails deterministically on a clean `db-reset` (`report:
  tenant A has 0 rows`), reproduces on `main` from before this session too. Not CI-wired.
- Issue #433 — `apps/gateway`'s `LocalQueueService` has a real FIFO-ordering flake when two
  `enqueue()` calls land in the same millisecond (pre-existing FEAT-026 bug, `apps/gateway` untouched
  by FEAT-027).

**Also this session:** hit and fixed, for real, the exact vitest/esbuild `design:paramtypes` gap
`engineering/testing` Skill entry #6 already documents (constructor-DI + metatype-DTO-validation
instances, in the new gateway/api code) — caught via real e2e tests before merge. No Skill update
needed; it already covered and correctly predicted both fixes.

**Carried into next session:**
- FEAT-027's real completion is blocked on identifying the design partner's actual instrument
  (protocol: ASTM vs HL7, vendor/model) — a real-world fact, not something derivable from either
  repo. Once known: write the real protocol driver, decide whether more unit conversion is needed
  than the current minimal multiply, and draft `domain/hl7-v2` only if the instrument turns out to
  speak HL7 (not drafted speculatively, same discipline `domain/analyzer-integration` followed).
- Issues #427, #430, #433 remain open, all deferred/filed this session.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` needs a human's `tofu apply`.
- Carried from session 28, still not done by a human: a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges
  read clearly at a glance.

**Next session, once the instrument question is resolved:** finish FEAT-027's real driver, or move
to FEAT-028 (transactional outbox + event bus) if the instrument identity is still blocked and
another M6 feature can proceed independently in the meantime.
