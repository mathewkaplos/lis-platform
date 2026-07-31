# Status — 2026-07-31 (session 5)

## What's actually done (per real evidence)

Session 4 carried forward three open Deploy-to-Staging findings (#189, #193,
#194) and left them explicitly unresolved. This session root-caused and
closed #189, #197 (a fourth finding from this session's own orientation),
and #198 (a fifth, more serious finding discovered while fixing #189).
**#193 and #194 remain open and genuinely unresolved** — see their own
section below; they are not silently folded into today's fixes.

- **#189 (Keycloak crash-looping on staging) — CLOSED, confirmed via direct
  console access, not just CI green.** Root cause: `KEYCLOAK_ADMIN_PASSWORD`
  GitHub secret was entirely missing (`gh secret list` showed no such
  secret, not a placeholder) — Keycloak's bootstrap admin password resolved
  to empty string end-to-end, refusing to boot. Fixed: generated a new
  value, `gh secret set KEYCLOAK_ADMIN_PASSWORD`, redeployed. Confirmed live
  via `docker compose ps`/`curl /health` run directly on the droplet, not
  just the pipeline's own smoke test.
- **PR #199 — smoke-test retry hardening.** The post-#189 redeploy's own
  smoke test still failed (exit 56) even though the fix worked — root cause
  was a *different*, timing-related bug: a flat `sleep 8` before the
  `curl /health` check wasn't enough once Keycloak started doing a real JVM
  boot + realm import (post-#189) instead of crash-looping instantly, on a
  1 vCPU/1GB droplet. Replaced with a 10-attempt/5s retry loop. This is
  general hardening against transient boot-timing — it does **not** explain
  or resolve #193/#194's original exit-56/exit-52 mysteries from session 4
  (see below).

## #198 — staging DB had never been migrated, ever (CLOSED, 4 PRs)

Discovered as a side effect while auditing secrets for #189:
`LIS_APP_DB_PASSWORD` was also entirely missing from GitHub secrets, and
`deploy-staging.yml` had no `ALTER ROLE lis_app` step at all (unlike
`db-reset.sh`/`pr.yml`, which both do this explicitly). Investigation via
direct console access (`\dt`/`\du`) confirmed it was worse than that:
**staging's Postgres had zero tables and no `lis_app` role — never
migrated, at all, since the environment was created.** Wrote an
Implementation Proposal (`docs/plans/task-198-staging-db-migration-bootstrap.md`,
approved) before touching anything, per Rule #0 — this was a new class of
pipeline behavior (first-ever remote schema creation), not a one-line fix.

Took **4 PRs** to actually land, each uncovered by the previous one running
far enough to hit the next real problem — worth remembering next time a
green CI run on this pipeline is trusted at face value:

- **PR #200** — core fix. Migrator image (reusing the API Dockerfile's
  `base` build stage, which already has `tsx`/`drizzle-kit`/`@lis/db`
  built), deploy-job reordering (stop api/web → migrate only against
  postgres → `ALTER ROLE` → seed → bring up the rest), `LIS_APP_DB_PASSWORD`
  secret set, compose network pinned (`lis_staging_net`). **First run OOM'd
  the droplet** (confirmed via console: `free -h` 951Mi/961Mi used, 0B
  swap, `docker compose ps` hung) — old api/web from the previous deploy
  were left running the whole time alongside postgres/valkey/keycloak/the
  new migrator container, on a 1 vCPU/1GB box with zero memory limits
  anywhere.
- **PR #201** — OOM hardening. Explicit `mem_limit` on every compose
  service (192+48+320+128+160 = 848m of ~961Mi total), capped
  `JAVA_OPTS_APPEND` on Keycloak (previously-unbounded JVM heap sizing was
  the single biggest consumer), `--memory=192m` on the migrator's
  `docker run`. Swap (0B on the droplet) added as a **manual one-time OS
  command directly on the droplet** — not via Terraform, since
  `infra/main.tf` `import`ed this droplet from an already-existing one
  rather than creating it, so adding `user_data`/cloud-init now risks
  Terraform wanting to force-replace it on a future `apply`.
- **PR #202** — a second, independent bug, found only after the OOM fix let
  the script run further: both prior runs had silently reported **success**
  while actually stopping right after `docker compose up -d postgres`.
  Root cause: the script is fed to `bash -s` via a heredoc over SSH, and
  `docker compose exec -T postgres pg_isready ...` — the first thing in the
  retry loop, exactly where both runs died — still forwards the parent
  shell's stdin into the container by default (`-T` only disables the
  pseudo-TTY, not stdin attachment), silently consuming the rest of the
  script meant for bash to read next. Bash then hit EOF on its own
  remaining input and exited 0, having done nothing wrong it could see.
  **Fix: `< /dev/null` on every inner command in that heredoc script that
  doesn't deliberately need real stdin.** Genuinely reusable knowledge if
  this pipeline (or any other `bash -s <<HEREDOC` over SSH) is touched
  again — a green step here is not proof of execution.
- **PR #203** — a third bug, surfaced once the above got far enough to
  reach it: `ALTER ROLE lis_app WITH PASSWORD :'pw'` (psql's `-v pw=.../-c`
  colon-interpolation) did not fire in practice — the literal text `:'pw'`
  reached the SQL parser, syntax error. Fixed by having bash substitute the
  password directly into the SQL text via a dedicated unquoted heredoc,
  sidestepping psql's own interpolation mechanism entirely rather than
  continuing to debug it.
- Verified directly on the droplet after PR #203 merged (not just CI green):
  `\du`/`\dt` showed `lis_app` role present and all 21 tables from
  migrations 0000–0011. `/health` returned `ok` from a freshly-started
  `api`.
- **PR #205** (found one deploy later) — the seed step
  (`db/seed/chemistry-catalog.sql`) is plain `INSERT`s with no idempotency
  guard, fine for CI/local (always wipe the DB first) but staging now runs
  it on every deploy per the approved design. Second deploy hit
  `duplicate key value violates unique constraint`. Fixed by checking the
  `analyte` row count first and skipping the seed if already populated,
  rather than editing the shared seed file's behavior for every
  environment.

## #197 — Tailscale connectivity blip (CLOSED)

Found during this session's own orientation: `Wait for Tailscale
connectivity to droplet` failed once (run 30617856139) with a plain
`tailscale ping -c 3` timeout, while direct console access confirmed the
droplet itself was fully healthy — narrowed to a transient blip or
GH-Actions-side tailnet-join flake, not a droplet-side fault. Confirmed via
8 subsequent deploy runs today, all successful at this step. **PR #204**
added a 5-attempt/10s retry loop (same pattern as #199) and closed the
issue citing the track record plus the added resilience.

## #193, #194 — still open, still genuinely unresolved

**Do not assume these are fixed by anything done this session.** Both are
from session 4: #193 (exit 56, run 30612203676) and #194 (exit 52, run
30615704260), both unreproduced at the time, neither explained by #189
(Keycloak) or by each other. Today's #199 smoke-test retry hardening may
mean a *future* transient blip with this exact signature self-heals instead
of failing the run — but that's a mitigation, not a root cause. If either
signature recurs and fails outright despite the retry loop, treat it as a
fresh, unexplained regression, not a re-occurrence of something already
understood. Worth a decision next session on whether to close #193/#194 as
superseded-by-mitigation or keep them open pending an actual explanation —
not decided here.

## Staging disk-full incident (resolved) + prevention

Found independently, mid-session: droplet's 25GB root disk hit 100% full
(`df -h`: 62M avail). **Root cause was NOT what it looked like at first** —
`/var/lib/docker` itself only held 1.1G; the real ~20GB was under
`/var/lib/containerd` (`io.containerd.snapshotter.v1.overlayfs` 16G +
`io.containerd.content.v1.content` 3.4G), since this Docker install uses
the **containerd image store**, a separate storage backend with its own
config (`/etc/containerd/config.toml`'s `root`, not Docker's `data-root`).
A first attempt at guidance (move Docker's `data-root` to a newly-attached
20GB Block Storage Volume) would **not** have fixed this — flagged and
corrected before any command touched the live droplet.

Actual fix was much simpler: `docker system df` showed 131 images, only 5
active, 18.44GB (89%) reclaimable — pure accumulated cruft from ~10
rebuild-and-redeploy cycles in a single day, which Docker/containerd never
auto-clean. `docker image prune -a -f` alone took root disk from 100% full
to 25% used (18G free). **The 20GB volume was not actually needed for this
problem** — confirmed directly with the user, who agreed not to migrate
Docker/containerd's storage onto it (real risk, for a problem pruning
already solved).

Prevention: **PR #207** added `docker image prune -a -f` as the last step
of every future deploy (confirmed working: reclaimed 1.594GB on its first
real run). **infra/main.tf** now documents the volume via a `data` source
(read-only reference, Terraform never manages its lifecycle) plus a
`digitalocean_volume_attachment` resource — flagged inline that it needs
`terraform import` before any `apply`, not run here (no local `terraform`
binary available to validate). **PR #206** also added a top-of-file comment
in `docker-compose.staging.yml` explaining the topology.

## Staging DB backups (new, automated)

**PR #208** — the previously-unused 20GB volume now hosts automated daily
`pg_dump` backups (`infra/scripts/backup-staging-db.sh`, custom format,
7-day retention, deployed to `/opt/lis/scripts` on every deploy). Cron
installation is a **one-time manual step**, not wired into the deploy
workflow (documented in `infra/scripts/README.md`) — confirmed installed
and working end-to-end: manual run produced a 104K `.dump` file, cron job
verified via `crontab -l`.

## Stale `lis_default` network incident (resolved, manual remediation, no code change)

Found at the very end of the session, after PR #209's breadcrumb-refresh
merge triggered yet another deploy (this pipeline redeploys on every push
to `main`, no path filter): `Pull and restart on droplet` failed with
`container ... is not connected to the network lis_default`. Direct
console check confirmed a real, live outage — `docker compose ps` showed
only `keycloak`/`valkey` up (leftover from the prior successful deploy),
`postgres`/`api`/`web` all down, `curl /health` returned nothing. Root
cause: **two networks existed simultaneously** — the currently-correct
`lis_staging_net` (pinned since PR #200) and a stale, leftover
`lis_default` (the pre-pinning auto-generated default), most likely a
residual artifact from one of this session's earlier full droplet reboots
during the OOM incident. `postgres` specifically hit a state conflict
trying to reconcile against the stale network entry.

**Fixed via manual remediation on the droplet, not a code change** — no PR,
since nothing in the repo caused this: `docker compose down` (removes
containers, does **not** touch the named `pgdata` volume) → `docker network
rm lis_default` → `docker compose up -d`. Confirmed recovered: all 5
containers `Started`, `curl /health` returned `{"status":"ok",...}`.

If a similar `network ... not found` / `not connected to the network`
error recurs on a future deploy, check `docker network ls` for a stale
duplicate network first before assuming a fresh pipeline bug — this exact
remediation (`down` → `network rm <stale-name>` → `up -d`) is safe and
reusable, since `down` without `-v` never touches named volumes.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: unchanged at 6 closed / 9
open (none of today's fixes were M2-tagged roadmap tasks — all were
infra/deploy bugs found ad hoc). M1 unchanged at 3 open/16 closed, all
three still individually blocked (see session 4 detail via git history,
`e44ce3e` and earlier, if needed — not repeated here).

M2's open items, current state:
- **#188** — Staging TLS + `KC_HOSTNAME` hardening. Still blocks "demoed on
  staging" DoD for #17/#18. Not touched this session.
- **#189** — CLOSED this session (see above).
- **PR #191 (draft)** — FEAT-010 Implementation Proposal, TASK-034 scope.
  Still open, still blocked on its own §10, not touched this session.
- **#192** — GCP billing/Stitch MCP decision. Still open, not touched.
- **#193, #194** — still open, genuinely unresolved (see dedicated section
  above — do not assume closed or explained).
- **#197, #198** — CLOSED this session (see above).
- **#93–96 (TASK-034–037)** — design-system build-out, unchanged, not
  touched this session.

**Unresolved finding, carried forward unchanged:** #74 (TASK-015)'s
out-of-band closure remains unverified from a prior session.

## Notes / gotchas for the next session

- **A green "Pull and restart on droplet" step on this pipeline is not
  proof of execution** — both #202 and (implicitly) the original OOM run
  reported success while the script had actually stopped partway through.
  If touching `deploy-staging.yml`'s SSH-heredoc script again, remember:
  any `docker exec`/`docker compose exec` inside a `bash -s <<HEREDOC`
  script fed over SSH needs `< /dev/null` unless it deliberately wants
  stdin, or it can silently eat the rest of the script.
- **psql's `-v var=value` + `-c "... :'var' ..."` colon-interpolation did
  not fire reliably here** — if setting a value via psql variables again,
  prefer bash-substituting the value directly into a dedicated heredoc
  passed to `psql`'s own stdin, rather than relying on `-c`.
- **This Docker install uses the containerd image store** — the real bulk
  of image/layer data lives under `/var/lib/containerd`, not
  `/var/lib/docker`. `data-root` in `/etc/docker/daemon.json` does **not**
  move it; containerd has its own `root` setting in
  `/etc/containerd/config.toml`. Neither has actually been changed — both
  are still at their defaults on root disk. Revisit only if disk pressure
  returns despite the new auto-prune step.
- **Image cruft accumulates fast on this pipeline** — every push to `main`
  builds fresh `:latest` images with no automatic cleanup. Now mitigated by
  PR #207's prune step; if disk fills again despite that, check
  `docker system df` first before assuming a capacity problem.
- **This machine still cannot reach the staging droplet directly** — no
  local Tailscale client, no OAuth credentials for the tailnet (unchanged
  from session 4). All droplet-side verification this session (`\dt`/`\du`,
  `free -h`, `docker compose ps`, backup script test run) was done by the
  human directly via the DigitalOcean console, not by this session.
- **PR #191 remains open, draft, blocked on §10** — not touched, not
  re-litigated this session.
- All figures above are current as of 2026-07-31 (session 5), gathered
  directly from `gh issue view`/`gh pr view`/`gh run view --log`/live
  console output pasted by the human this session. Re-verify against
  GitHub/the live droplet directly if much time has passed — especially
  the #193/#194 non-resolution and the containerd-storage note above.
