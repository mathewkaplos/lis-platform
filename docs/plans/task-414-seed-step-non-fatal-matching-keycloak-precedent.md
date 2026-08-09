# Implementation Proposal: Make the seed step non-fatal, matching the Keycloak block's own precedent
Status: APPROVED
ADR: none (defensive resilience change, no architectural decision)    Date: 2026-08-09    Backlog ID: close-report Finding B (session 28)

## 1. Goal
`deploy-staging.yml`'s remote script runs under `set -euo pipefail`. The seed
step (`docker compose exec -T postgres psql ... -f - < seed/<file>.sql`) is
fatal — any error there aborts the whole script immediately, before
`docker compose up -d api web` (further down the same script) ever runs.
This session hit that exact failure class twice (issue #410, 2026-08-09):
two full-site outages, both caused by a seed-data bug, not by anything
actually wrong with the built images or containers.

The Keycloak-admin-API block, a few lines below the seed step in the same
file, already carries its own documented history of this identical failure
class: "this whole block used to `exit 1` on any failure here, which —
combined with api/web already being stopped above — meant a single
transient Keycloak hiccup took the *entire* site down... Confirmed real, not
hypothetical." It was made non-fatal on 2026-08-03. The seed step was never
given the same treatment, and this session paid for that gap twice.

Fix: apply the identical "capture failure, warn, continue" pattern already
proven for Keycloak to the seed step, so a seed-data bug degrades to
"catalog data incomplete this deploy" instead of "site down."

## 2. Affected files
- `.github/workflows/deploy-staging.yml` — wrap each of the two seed
  invocations (`chemistry-catalog.sql`, `haematology-catalog.sql`) in
  `if ! <cmd>; then echo "WARNING: ..." >&2; fi`, matching the Keycloak
  block's own idiom for surviving under `set -e` (a command's exit status
  used as an `if` condition does not trigger `set -e`, unlike a bare
  command).

## 3. Architecture consulted
- The Keycloak block itself (same file, ~line 339-357) — the exact reference
  pattern being mirrored, including its own inline rationale.
- `docs/scope/current.md` / session 28's close report Finding B — the
  incident and rubric that motivated this proposal.

## 4. Skills loaded
- `engineering/docker-pnpm-monorepo-deploy` — same Skill this session
  already extended twice (entries on `-T`'s two distinct effects).

## 5. Assumptions & autonomous decisions
- **Explicit human call, already made:** a failed seed leaves catalog data
  incomplete rather than blocking the deploy — a real data-completeness
  risk, differing from Keycloak's own case (a stale non-critical admin
  setting, self-healing next deploy) in that catalog data doesn't
  self-heal on its own the same way. Per this session's own explicit
  approval ("resolve all," in response to the close report naming this
  exact tradeoff), the deploy pipeline's uptime is prioritized over blocking
  on a seed-data failure — matching the same reasoning Keycloak's own fix
  already established for a different, but structurally identical,
  post-migration step.
- Both seed invocations get independent `if`/`warning` wrapping (not a
  single combined check) — so haematology's seed still attempts to run even
  if chemistry's own seed step fails, and vice versa, rather than one
  failure silently skipping the other (they are logically independent
  disciplines' catalogs).

## 6. Risks
- **A future seed-data bug will now fail silently from the deploy's own
  green/red status** — only visible via the `WARNING:` line in the deploy
  log, not the overall run conclusion. This is the deliberate, approved
  tradeoff (§5) — worth a standing reminder that "Deploy to Staging went
  green" no longer implies "the seed step actually succeeded," the same
  caveat this session's own task-410 testing plan already had to learn the
  hard way for a different reason (CI's fresh containers can't reproduce a
  staging-drift bug at all).
- Not fixing the underlying possibility of future seed bugs — this is
  containment (limit blast radius), not prevention (task-410's fix already
  addressed the one concrete bug found this session).

## 7. Acceptance criteria
- A seed step failure no longer aborts the remote script — `docker compose
  up -d api web` still runs regardless.
- YAML remains valid; a seed step *success* (the normal case, confirmed
  working as of task-410's merge) behaves identically to before — no output
  or behavior change on the happy path.

## 8. Testing plan
- YAML syntax validated (`python3 -c "import yaml; yaml.safe_load(...)"`).
- Cannot locally reproduce the remote SSH script's own `set -e` behavior
  (that's specific to the real remote bash invocation, not something
  `docker compose exec` alone exercises) — reviewed by hand against the
  exact working Keycloak-block idiom already proven live in this same file,
  same shell, same `set -e` context.
- Next automatic deploy (triggered by this PR's own merge) exercises the
  *happy path* only (seed already succeeds as of task-410) — this doesn't
  prove the non-fatal wrapper itself works under a real failure, only that
  it doesn't regress the working case. That's an accepted gap per §6 — the
  next actual seed failure (hopefully never) is the real test.

## 9. Rollback plan
- Purely additive `if`/`echo` wrapping around two existing commands — no
  change to what the commands themselves do. Reverting restores the
  previous fatal behavior exactly.

## 10. Questions requiring human approval — ANSWERED 2026-08-09
1. **Approve the non-fatal tradeoff itself** (§5) — APPROVED, per "resolve
   all" in response to the close report naming this exact question.
