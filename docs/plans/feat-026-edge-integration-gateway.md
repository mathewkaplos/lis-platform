# Implementation Proposal: FEAT-026 — Edge integration gateway
Status: APPROVED
ADR: adr-0026 (M2M auth — see §10 Q2)
Date: 2026-08-09    Backlog ID: FEAT-026 (issue #35)

## 1. Goal

Stand up the **Integration Gateway** skeleton described in KB-29: a standalone,
on-prem/edge-deployable service that hosts a common ingestion port and a local
store-and-forward queue, so that a future instrument driver (FEAT-027) has
somewhere real to plug into, and the lab's result capture can continue during a
cloud-connectivity outage per KB-40 (offline strategy).

Scope is deliberately narrow, matching issue #35's own two acceptance criteria —
this is the gateway's skeleton and reliability mechanism, **not** instrument
protocol drivers (ASTM/HL7/POCT1-A2 parsing is FEAT-027, which depends on this
feature landing first):

- The gateway deploys and runs independently of `apps/api`/`apps/web`, on-prem.
- A local store-and-forward queue buffers ingested raw results and survives a
  simulated network interruption between the gateway and the cloud core,
  forwarding once connectivity is restored, without duplicating on retry.

## 2. Affected files

- **New** `apps/gateway/` — a new pnpm workspace app (NestJS, matching
  `apps/api`'s stack for consistency, per `engineering/docker-pnpm-monorepo-deploy`).
  - `src/ingest/` — the common ingestion port (one HTTP endpoint accepting a raw
    payload + a synthetic/mock "driver" for testing; no real instrument parser
    yet).
  - `src/queue/` — the store-and-forward queue (local durable storage; see §5
    for the storage-mechanism decision).
  - `src/forward/` — the forwarder that drains the queue to the cloud core's
    ingestion API, with the idempotency key KB-29 specifies:
    `(instrument_id, specimen_id, analyte, run_id)`.
  - `Dockerfile`, `package.json`, `pnpm-workspace.yaml` entry.
- `apps/api/src/...` — a new internal ingestion endpoint the gateway forwards
  to (thin; validates + hands off into the existing result pipeline). Exact
  shape TBD during implementation, not designed in this proposal.
- `infra/docker-compose.staging.yml` — whether the gateway is added here at all
  is itself an open question (§10) — it's meant to run **on the lab's
  premises**, not necessarily on the same droplet as staging.
- `packages/domain/src/` — a `RawResult` / ingestion-event shape, if shared
  typing between gateway and api is worth it at this stage (kept minimal).
- No changes to `packages/db` or the `observation` schema — this phase does not
  touch Observation writing paths (see §6 on the pre-existing FK gap).

## 3. Architecture consulted

- **KB-29 Analyzer Integration** — primary source; topology diagram, ingestion
  pipeline steps 1-6, idempotency key, reliability model, design-decisions
  table.
- **KB-40 Offline Strategy** — referenced by KB-29 for the edge-buffering
  rationale; not fully read in this pass — worth a closer read before
  `/develop` starts, flagged in §10.
- **KB-25 Workflow Engine** — confirms the gateway hands off into the existing
  result pipeline (range resolution, delta, critical detection, QC gate,
  auto-verification) rather than reimplementing any of it; the gateway's own
  scope stops at "emit a structured Observation candidate."
- **KB-05 System Architecture** — gateway's position relative to Cloud Core.
- **ADR-0005** (forward-referencing columns) + **issue #260** — real,
  currently-open gap: `observation.ordered_test_id`/`specimen_id` have **no
  Postgres FK constraint**, only application-level enforcement. Directly
  relevant because the gateway's eventual correlation step (sample ID/barcode
  → OrderedTest) is exactly the kind of write path that gap protects against
  failing loudly. Not fixed here — #260 is separately tracked — but called out
  as a risk in §6 since this feature increases the number of write paths that
  gap affects (even though this phase doesn't write Observations yet).

## 4. Skills loaded

- `engineering/docker-pnpm-monorepo-deploy` — for the new app's Dockerfile/CI
  wiring; its documented pnpm v11 / `pnpm-workspace.yaml` / lockfile gotchas
  apply directly to adding a fourth deployable app.
- `engineering/api-design` — for the ingestion port and the new internal
  api endpoint.
- `engineering/authentication` — read for context; does **not** yet cover
  machine-to-machine (gateway → cloud core) auth, which is user/OIDC-session
  shaped today. Flagged as an open question, §10.
- `domain/analyzer-integration` — **does not exist yet.** Per this feature's
  own "Required Skills" listing, drafting it is expected to happen as part of
  planning this feature. Not written in this pass (see §10 — proposing to
  draft it as a follow-up once the skeleton's real shape is proven, rather
  than writing a Skill ahead of any working code, which risks the Skill
  describing something that changes once implementation starts).

## 5. Assumptions & autonomous decisions

- **Stack**: the new `apps/gateway` reuses NestJS + the existing pnpm/Docker
  conventions rather than introducing a new language/runtime, to keep
  `docker-pnpm-monorepo-deploy`'s lessons applicable and avoid a second build
  toolchain. This trades away a lighter-weight edge footprint (a Go/Rust
  static binary would deploy more simply to constrained lab hardware) for
  consistency; revisit if real lab hardware constraints surface later.
- **No real instrument driver in this phase.** The ingestion port accepts a
  generic raw-payload shape and a synthetic/mock driver exercises it end to
  end. Real ASTM/HL7 parsing is FEAT-027's explicit scope, not duplicated
  here.
- **Idempotency key** follows KB-29 verbatim:
  `(instrument_id, specimen_id, analyte, run_id)` — applied at the forwarder,
  not the queue (the queue may still contain a duplicate locally; dedup
  happens on forward/hand-off, matching KB-29 step 5).
- **This phase does not write to `observation`** — the internal api endpoint
  the gateway forwards to is a new, thin ingestion endpoint; wiring it into
  the *existing* result pipeline (range resolution → auto-verify) is treated
  as part of FEAT-027 (once there's a real driver producing real mapped
  values), not this skeleton. Keeps this proposal's blast radius to a new,
  isolated app with no schema changes.

## 6. Risks

- **`observation.ordered_test_id`/`specimen_id` have no DB-enforced FK**
  (issue #260, ADR-0005). Not this feature's write path yet, but every
  feature that gets closer to that write path (this one, then FEAT-027)
  raises the cost of leaving it open. Recommend flagging #260 for
  prioritization before FEAT-027 (which *will* write Observations) rather
  than at that feature's own kickoff.
- **No machine-to-machine auth story yet.** `engineering/authentication`
  covers human OIDC sessions; the gateway is an unattended service
  authenticating to the cloud core. Needs a real decision (service account +
  mTLS? scoped API key? Keycloak client-credentials grant, reusing the
  existing single-realm design from ADR-0009?) before the forwarder can be
  more than a stub. Surfaced as an open question, not decided here.
- **Deployment topology undecided.** KB-29 says "often on-prem"; the existing
  `infra/` is entirely one staging droplet via OpenTofu/Tailscale. Whether the
  gateway is (a) a container image the lab's own IT runs, unmanaged by our
  CI/CD, or (b) something we still provision via Tailscale onto lab-adjacent
  hardware, materially changes what "deploys and runs on-prem independently"
  means for acceptance testing. Open question, §10.
- **`domain/analyzer-integration` Skill doesn't exist.** Planning and
  `/develop` for this feature and FEAT-027 are proceeding without it; risk of
  losing lessons learned during this build if the Skill isn't drafted
  promptly afterward (per AGENTS.md's standing rule on capturing real gotchas
  same-day).

## 7. Acceptance criteria

(carried from issue #35, made concrete)

- [ ] `apps/gateway` builds, has a Dockerfile, and runs as a container
      independent of `apps/api`/`apps/web` — verified by starting it with
      those two stopped/unreachable and confirming it still accepts ingestion
      requests and queues them.
- [ ] A simulated network interruption (cloud core unreachable) causes ingested
      raw results to buffer in the local queue rather than being dropped or
      raising an unhandled error.
- [ ] On reconnection, the forwarder drains the queue to the cloud core's
      ingestion endpoint, and a repeated/replayed message (same idempotency
      key) does not produce a duplicate downstream record.

## 8. Testing plan

- Unit tests: queue enqueue/dequeue, idempotency-key computation, forwarder
  retry/backoff logic.
- Integration test: start gateway + a stub cloud-core receiver in Docker
  Compose; send N raw payloads; kill the receiver mid-stream; confirm the
  gateway keeps accepting and queuing; restart the receiver; confirm all N
  arrive exactly once (including the ones sent during the outage).
- No RLS/tenant-isolation test needed this phase (no tenant-scoped table
  created); no golden-dataset test needed (no clinical mapping logic yet).

## 9. Rollback plan

Entirely new, isolated app with no schema migrations and no changes to
existing `apps/api`/`apps/web` request paths. Rollback is: don't deploy the
new container / revert the `apps/gateway` addition and any CI workflow change
that builds it. Zero risk to already-shipped M1-M5 functionality.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

All four resolved by the human during this planning pass, before `/develop`
begins:

1. **Deployment topology — RESOLVED: we provision it.** `apps/gateway` is
   provisioned via the existing Tailscale/OpenTofu staging pattern, extended
   to a lab-simulated "edge" node we control (not handed unmanaged to a
   customer's IT). This means `infra/` does gain changes in this feature
   (new node/service definition), and the acceptance test can target a real,
   CI-reachable environment rather than a customer-operated black box.
2. **Machine-to-machine auth — RESOLVED: Keycloak client-credentials grant.**
   Reuses the existing single-realm design (ADR-0009). Written up as
   **ADR-0026** (`adr-0026-gateway-uses-keycloak-client-credentials-grant-not-a-separate-api-key-scheme.md`),
   status accepted. The forwarder's auth code should follow that ADR's
   acceptance criteria directly — no separate API-key mechanism.
3. **Issue #260 (observation FK gap) — RESOLVED: prioritize ahead of
   FEAT-027.** Human confirmed: closing #260 (adding the DB-enforced FK on
   `observation.ordered_test_id`/`specimen_id`) should land before FEAT-027
   starts writing real Observations from analyzer data. Noted on the issue
   itself; FEAT-027's own kickoff should treat #260 as a prerequisite, not
   independently-scheduled backlog debt.
4. **`domain/analyzer-integration` Skill timing — RESOLVED: after this
   feature's `/develop` pass.** Draft it once the real
   queue/forward/ingestion-port skeleton exists and its actual shape is
   proven, rather than ahead of any code. This proposal's own `/develop` pass
   should end with drafting that Skill as a documented follow-up step, before
   FEAT-027 begins.
