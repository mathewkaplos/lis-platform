# Status — 2026-08-09 (session 29)

Last commit on main: `0f27c08` (`lis-platform`) / `f7cc408` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction (a breadcrumb commit can never state its own SHA) — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M6 — "Automate" is open: FEAT-026 (Edge integration gateway) kicked off and shipped this session

Session started with a full `/orient`. M5 confirmed fully closed (19/19 issues); M6 confirmed open
(7 issues: EPIC-005 + 6 features, all "Not Started"). One real drift finding surfaced during
orientation and was deliberately deferred, not fixed: `lis-engineering/retrospectives/` has only
`M0-retrospective.md`, despite M1-M5 all being closed — tracked as `lis-platform` issue #427, human
decision was "defer, note as known gap," not backfill this session.

**FEAT-026 (Edge integration gateway)** — the first M6 feature, per its stated dependency order —
went through the full `/plan` → open-questions-resolved → ADR → `/develop` → verify → PR →
CI-green → merge pipeline, no shortcuts. Scope deliberately narrow, matching issue #35's own two
acceptance criteria (the gateway skeleton, not instrument protocol drivers — those are FEAT-027):

- **New `apps/gateway` app**: `POST /ingest` (the common ingestion port, persists the raw payload
  verbatim to a local file-backed durable queue before any parsing — KB-29 step 1), the
  store-and-forward queue itself (write-temp-then-rename, FIFO, survives a process restart, zero
  new dependencies), and a forwarder that drains the queue on an interval to the cloud core,
  authenticating via a Keycloak client-credentials grant (**ADR-0026**, accepted).
- **New `apps/api` endpoint** `POST /internal/gateway/ingest`, guarded by the existing
  `JwtAuthGuard`/`CapabilityGuard` with a new `gateway_ingest` capability granted only to a new
  `gateway-ingest` machine role — never a human role. Dedupes on the shared
  `(instrument_id, specimen_id, analyte, run_id)` idempotency key. Deliberately does not write any
  `Observation` yet — proposal §5/§9 scopes that hand-off to FEAT-027.
- Idempotency-key/schema logic lives once in `@lis/domain` (`raw-result.ts`) so gateway and api can
  never independently drift on what "the same result" means.
- `infra/keycloak/lis-realm.json`: new `lis-gateway` confidential client + `gateway-ingest` realm
  role + pre-seeded service-account user, verified end-to-end against the real local dev Keycloak
  (restarted the container to re-import — `docker compose up -d --force-recreate keycloak`, since a
  plain `docker restart` failed on a stale WSL/Docker-Desktop bind-mount path).
- Merged `lis-platform` PR #428, closing issue #35. `apps/gateway/Dockerfile` verified locally:
  builds, runs standalone, serves `/health` with `apps/api`/`apps/web` both stopped — proving the
  "deploys and runs independently" AC at the container level, not just via the test suite.

**Four open questions from the Implementation Proposal were resolved with the human before
`/develop` began** (not left for a later session): deployment topology (we provision it, extending
the existing Tailscale/OpenTofu staging pattern — not yet done, see below), M2M auth (Keycloak
client-credentials, → ADR-0026), issue #260 priority (fix before FEAT-027, not independently
scheduled), and `domain/analyzer-integration` Skill timing (draft after this feature's `/develop`
pass, not ahead of code — **still outstanding, carried to next session**, see below).

**Hit and fixed, for real, the exact vitest/esbuild `design:paramtypes` gap `engineering/testing`
Skill entry #6 already documents** — both the constructor-DI instance and the metatype-based-DTO-
validation instance, in the new gateway/api code. Caught via real e2e tests against live
Postgres/Keycloak before merge, not shipped. No Skill update needed: the existing entry already
covered and correctly predicted both fixes (`@Inject(Service)` explicit; `@Body(new
ZodValidationPipe(schema))` explicit) — a case of the discipline working exactly as designed, not a
new gotcha.

**Explicitly not done this session, needs a human:** the actual on-prem/edge infrastructure
provisioning (extending Tailscale/OpenTofu to a lab-simulated edge node) is a real, billable,
hard-to-reverse `tofu apply` — outside this session's autonomy boundary (same Level 3 gate the
`engineering-radar` Skill's own SSH-IP auto-remediation section draws). The Dockerfile is the
artifact a human deploys once that infra exists.

**Carried into next session:**
- Draft the `domain/analyzer-integration` Skill from KB-29, now that the gateway skeleton's real
  shape (ingest/queue/forward split) is proven — per the resolved Q4 above, this was deliberately
  deferred to *after* FEAT-026 landed, not skipped.
- Issue #260 (`observation.ordered_test_id`/`specimen_id` has no DB-enforced FK) should be treated
  as a prerequisite when FEAT-027 (Analyzer #1 driver) is kicked off, not independently scheduled —
  FEAT-027 is the feature that actually starts writing Observations from analyzer data.
- Issue #427 (missing M1-M5 milestone retrospectives) remains open, deferred, not yet actioned.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` (see above) needs a human's
  `tofu apply` before any live analyzer traffic can actually reach it.
- Carried from session 28, still not done by a human: a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing (reads slightly tight in agent screenshots), and a live pass
  confirming FEAT-022's SLA amber/red badges read clearly at a glance (not just in a screenshot).

**Next after that:** FEAT-027 (Analyzer #1 driver + idempotent ingestion) is next in M6's dependency
order — needs its own kickoff (research → `/plan` proposal → ADR if warranted), same as FEAT-026
this session, including the #260 prerequisite noted above.
