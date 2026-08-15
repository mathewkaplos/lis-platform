# Status — 2026-08-15 (session 38, refreshed)

Last commit on main: `1598dd0` (`lis-engineering`) — `lis-platform`'s own last commit before this
breadcrumb refresh itself lands is `058c0c0`; this refresh will land as a further `lis-platform`
commit on top of that, so that line will already be one commit behind by construction — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## Issue #564 (staging droplet memory headroom for MinIO) — fully resolved this session, PR #587

Session 37's breadcrumb left this open, blocking FEAT-061/FEAT-067 from real staging deployment.
This session: merged the already-drafted PR #587 (droplet resize `s-1vcpu-1gb` → `s-1vcpu-2gb`,
MinIO wired into `infra/docker-compose.staging.yml`), then ran the real `tofu apply` live.

**A real, unrelated security exposure was found and fixed in the same apply, not planned going
in:** the staging droplet's firewall (`lis-staging-fw`) had been deleted out-of-band at some point
— confirmed via a direct `404` from DigitalOcean's own API against the firewall ID OpenTofu's state
file still referenced. The droplet had been running with **no firewall at all**, every port open to
`0.0.0.0/0`, for an unknown period. The same `tofu apply` that resized the droplet also recreated
the firewall correctly scoped (bundled the also-live SSH-IP-drift fix into the same apply, per
`engineering-radar`'s own standing finding). `MINIO_ROOT_PASSWORD` generated and set; a fresh
`Deploy to Staging` run triggered and verified — not just CI-green, but directly on the droplet via
SSH: container health, real memory headroom (286Mi free + 862Mi swap, vs. the prior ~110Mi), and
`api` → `minio` reachability (`200` on MinIO's own health endpoint from inside the `api` container).

**Also found live, mid-apply:** the DigitalOcean API token in `infra/terraform.tfvars` had gone
stale (`401` on every call) — the human supplied a fresh one. `engineering-radar` gained a standing
check for this (see below).

## Issue #531 (rotate `lis-platform-analytics` Keycloak client secret) — fully resolved this
session, PR #588, via its own Implementation Proposal (`docs/plans/task-531-...md`)

The issue named `lis-platform-analytics`, but investigation found that client has **zero live
consumers anywhere in this repo** — a latent risk, not an active one. A more urgent instance of the
identical gap, which #531 didn't itself name, was found in the same pass: `apps/api`'s own
`KeycloakAdminAuthService` (FEAT-049 self-service signup, ADR-0040, already live on staging) falls
back to the checked-in `dev-only-lis-onboarding-secret` placeholder when `ONBOARDING_CLIENT_SECRET`
is unset — which it was. Staging's real `/signup` flow was authenticating against Keycloak with a
secret sitting in git.

Fixed both in one proposal (scope explicitly confirmed with the human, not decided unilaterally):
`deploy-staging.yml` now rotates both clients' real Keycloak secret to a repo-secret value on every
deploy (same GET/jq-merge/PUT idiom as the existing `unmanagedAttributePolicy` fix), and
`ONBOARDING_CLIENT_SECRET` is wired into `api`'s own environment. `lis-gateway`/`lis-interop`
deliberately excluded — neither is deployed to staging yet. Verified live, not just CI-green: a
client-credentials grant with the OLD placeholder now gets real `401 unauthorized_client`; the same
grant with the value `api`'s own env actually holds gets a real `200` + access token. New Skill
entry: `engineering/authentication` #17 (don't assume the issue-named client is the only live
instance of a gap — grep every real consumer).

## `/retro` this session — one friction found and fixed, applied immediately not just drafted

Verifying PR #588's merge, a purely read-only chained `git`/`gh` command was denied by the
auto-mode classifier — a gotcha `AGENTS.md`'s own "Rules of engagement" already documents in full
detail (including the direct fix), but the session never actually read `AGENTS.md`, because
`~/work/lis-engineering/playbooks/session-start/CHECKLIST.md` had an explicit load step for the
Constitution but none for `AGENTS.md`, despite citing its rules three times as already-known.
**Fixed:** `CHECKLIST.md` item 10 now loads both, non-negotiable, every session.

## `/close` this session — one process finding approved and applied

Pre-Close Report (`~/work/lis-engineering/session-close-reports/2026-08-15-1631-pre.md`): the
DigitalOcean-token staleness found live during #564's own apply (above) is a real, recurring risk
class — same shape as the already-standing SSH IP drift check. **Fixed:** `engineering-radar`
gained a new "DigitalOcean API token validity" check, same section, same cadence.

## Manual Verification Checklist — carried, not yet done live

- FEAT-065/066 (`apps/web`, pre-FEAT-067, unchanged from session 37): `/patients/new` (5 new
  contact fields + duplicate-found resubmission), `/patients/:id` (new demographic rows),
  `/admin/referring-facilities` (list+create + permission fallback), `/orders/new` (Referring
  facility select + Requesting doctor field), `/orders/:id` (Requesting doctor line), sidebar
  "Referring facilities" nav (French string unreviewed).
- FEAT-067 (`apps/web` + WSI mechanism, unchanged from session 37): only tested against a tiny
  synthetic 3-level/1-tile-per-level fixture. Still owed: the viewer's real behavior against an
  actual multi-level DZI export from a real slide scan; the `apps/web` tile-proxy route under real
  concurrent tile-request volume; `/cases`/`/cases/:id`'s own visual polish; `fr.json`'s "Dossiers"
  string.
- **New this session:** issue #564 — a real authenticated image-attachment (FEAT-061) and WSI
  (FEAT-067) upload/read round-trip against staging MinIO, through the actual `apps/web` UI. Every
  machine-checkable layer (container health, memory, reachability) is already verified live; the
  human-facing upload flow itself is not.
- **New this session:** issue #531 — a real self-service `/signup` completion on staging through
  the browser, confirming account creation still works end-to-end now that `lis-onboarding`'s
  secret has rotated. The credential mechanism itself is verified directly; the full human-facing
  flow through `apps/web` is not.

## Carried into next session

- **New this session:** issue #564 fully resolved (droplet resize, MinIO wired and verified live,
  the out-of-band-deleted firewall found and fixed, SSH IP drift bundled in) — closed, PR #587.
- **New this session:** issue #531 fully resolved (both `lis-platform-analytics` and the more
  urgent `lis-onboarding` live gap rotated and verified live) — closed, PR #588.
- **New this session:** `engineering-radar` gained a DigitalOcean token validity check;
  `CHECKLIST.md` now loads `AGENTS.md` at session start.
- **Resolved, no longer carried:** the SSH IP drift item from prior sessions' breadcrumbs — fixed
  as part of #564's own `tofu apply` this session.
- No new milestone/epic has been scoped yet for what comes after M13 — the roadmap's own Phase 5
  (AI & advanced: molecular/blood bank packs, digital pathology) is the one clearly-unstarted major
  direction; #546 (AI-assisted synoptic pre-fill, deferred from EPIC-012) is a real, already-filed
  entry point if that's the next pick.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds screens) remains
  open, unstarted, unchanged.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
- Issues #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- Deliberately-deferred M11/M12 follow-ups remain open, tracked, not blocking (#506, #507, #509,
  #510 under M11; #519, #520 under M12), same as prior sessions.
- Manual Verification Checklist items from session 35 remain open, unchanged: #529 (real
  antibiogram S/I/R rendering in `apps/web`), #530 (real culture-report PDF appearance).
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- The staging droplet's `restore-drill.sh` cron job still has no active alerting beyond its own log
  file — unchanged, still worth a periodic human spot-check until real alerting exists.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review); FEAT-049's `/signup` UX (now also
  needs a real pass given #531's secret rotation, see Manual Verification Checklist above);
  FEAT-046's take-payment UX + confirming the placeholder billing metadata reads unambiguously as
  placeholder; FEAT-045's Constitution-gate marker-recognition logic; a live technologist pass on
  FEAT-024's notes-textarea/grade-button spacing; a live pass confirming FEAT-022's SLA amber/red
  badges read clearly at a glance.
