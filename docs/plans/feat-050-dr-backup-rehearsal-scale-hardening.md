# Implementation Proposal: FEAT-050 DR, backup rehearsal & scale hardening
Status: IMPLEMENTED (merge commits: #495 f57930a, #496 5267d09, #497 e56b049)
ADR: adr-0044 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-050 (#59)

**Both ACs proven live against the real staging droplet, 2026-08-11:**
- **Restore drill**: ran for real, twice (first run caught two genuine bugs -- see §5's own
  "Real finding" entries -- second run passed clean). `PASS restore-drill: ...restored
  successfully (test_definition=19 analyte=45 code_system_value=57)`. Live database's own row
  counts confirmed identical before/after (`0|19|0`), scratch project confirmed fully torn down
  (zero leftover containers/volumes/networks). Cron installed (`30 3 * * *`).
- **Rollback rehearsal**: triggered for real via `workflow_dispatch` at 10:57:41Z, completed
  10:58:42Z -- **~60 seconds**, well under the AC's 5-minute budget. Verified not a no-op: `docker
  inspect`'s own image content-hash IDs for both `lis-api-1`/`lis-web-1` changed
  (`174042888d80...`/`608b41d838d8...` → `3d73361ff133...`/`70412a781739...`), proving genuinely
  different image content was deployed, not a same-version cycle. Staging then redeployed to
  main's real current state as the rehearsal's own final step.
- **Real bug found and fixed along the way** (separate from the two restore-drill findings):
  `rollback-staging.yml` itself silently registered with 0 runnable jobs due to a doc comment
  literally containing the empty-expression text `` ${{ }} `` -- GitHub Actions scans an entire
  `run:` block for `${{ }}` patterns regardless of bash `#` comments, so this invalidated the whole
  workflow file. Found only by actually trying to trigger it; fixed and confirmed with
  `actionlint` (PR #497).

**Approved 2026-08-11** via the native options-prompt (all three §10 questions accepted as
recommended: ADR-0044's scope cuts as drafted, application-image-only rollback boundary, and
performing the rollback rehearsal for real against the live staging droplet).

## 1. Goal
"Prove the platform survives failure and scales under real load" (issue #59's own purpose line).
Literal AC: "A full backup restore is rehearsed successfully on a schedule" and "Rollback of a
production deploy is rehearsed and completes within 5 minutes."

**Central finding, surfaced before any design choice (ADR-0044) — from reading the real, live
staging environment, not just the codebase:**
- A daily backup already runs successfully (`infra/scripts/backup-staging-db.sh`, confirmed live
  via SSH: 8 consecutive real `.dump` files on the droplet). What's missing is proof the *restore*
  path works — it has never been exercised.
- **There is currently no way to roll back a deploy at all.** `deploy-staging.yml` pushes every
  image to a single mutable `:latest` tag and prunes all local images on the droplet on every
  deploy. AC #2 isn't "rehearse an existing rollback" — the rollback mechanism has to be built
  first.

ADR-0044 scopes v1 to exactly these two pieces, against the real single-droplet staging
environment that exists today (`infra/main.tf`: one DigitalOcean `s-1vcpu-1gb` droplet) — not
KB-49's fuller PITR/multi-region/automated-failover vision, which has no real forcing function at
this pre-launch stage.

## 2. Affected files
- `infra/scripts/restore-drill.sh` (new) — deployed to `/opt/lis/scripts` by `deploy-staging.yml`,
  same mechanism `backup-staging-db.sh` already uses. Restores the most recent `.dump` into a
  throwaway scratch Postgres container (its own `docker compose -p lis-restore-drill -f
  restore-drill-compose.yml` project, an ephemeral named volume, a `mem_limit` sized within the
  droplet's already-tight budget per `docker-pnpm-monorepo-deploy` Skill entry #13), runs a row-count
  sanity check on 3 fixed tables (`test_definition`, `analyte`, `code_system_value` -- not
  `tenant`/`patient`, both confirmed live to be legitimately zero on this real pre-launch staging
  environment), logs pass/fail, and
  **always** tears the scratch project down (`docker compose ... down -v`) in a `trap`/`finally`,
  regardless of outcome. Every `docker compose exec -T` call gets `< /dev/null`
  (`docker-pnpm-monorepo-deploy` Skill entry #10 — this script isn't itself run over an SSH
  heredoc, but the same stdin-forwarding trap applies identically to any retry loop inside it).
- `infra/scripts/restore-drill-compose.yml` (new) — the scratch Postgres project definition (a
  single `postgres:16` service, no ports published to the host beyond localhost, matching
  `docker-compose.staging.yml`'s own image pin).
- `infra/scripts/README.md` — documents `restore-drill.sh`'s one-time cron setup (mirroring
  `backup-staging-db.sh`'s own documented setup exactly), offset to run at 03:30 UTC (after the
  03:00 backup completes, so it always drills the freshest dump) and where its log lives.
- `.github/workflows/deploy-staging.yml` — `build-and-push` job: each of the three
  `docker/build-push-action@v6` steps gains a second tag, `:${{ github.sha }}`, alongside the
  existing `:latest` (additive — nothing existing changes behavior). "Copy compose file and realm
  config to droplet" step: also copies `restore-drill.sh`/`restore-drill-compose.yml`, mirroring
  the existing `backup-staging-db.sh` copy exactly.
- `.github/workflows/rollback-staging.yml` (new) — `workflow_dispatch` only (never fires on push),
  one required input (`sha`, the git SHA to roll back to). Re-shapes `deploy-staging.yml`'s own
  proven Tailscale-connect → SSH → "stop api/web, pull `:<sha>` images, `up -d api web`" → smoke
  test sequence, parameterized by the input SHA instead of hardcoded `:latest`. Deliberately
  **skips** the migrate/seed/Keycloak-realm-reapply steps entirely — a rollback redeploys
  application images only (ADR-0044's own explicit boundary), never touches the database schema or
  realm config.
- `docs/plans/feat-050-dr-backup-rehearsal-scale-hardening.md` (this file).

## 3. Architecture consulted
- KB-49 (Disaster Recovery) — the destination this v1 deliberately doesn't fully build yet;
  ADR-0044 documents exactly which parts.
- KB-39 (Scalability) — read; nothing in it applies to a single 1vCPU/1GB staging droplet with no
  real load yet (its own multi-instance/autoscaling/read-replica content is squarely KB-49-style
  future work, not attempted here — "scale hardening" in this feature's own title is satisfied by
  the rollback mechanism itself, the real safety net for *any* future scale-related incident, not
  by adding autoscaling infrastructure that has no current forcing function).
- `infra/main.tf`, `infra/docker-compose.staging.yml`, `.github/workflows/deploy-staging.yml`,
  `infra/scripts/backup-staging-db.sh` — read and confirmed live against the real droplet (SSH),
  not assumed from source alone: 8 real daily backups present, 5 real running containers, real
  cron entry.
- `engineering/docker-pnpm-monorepo-deploy` (the feature's own issue names "engineering/deployment"
  as a required Skill — no Skill by that exact name exists; this is the Skill that actually covers
  this ground, confirmed by its own 27 entries directly matching this droplet's real, hard-won
  gotchas. Flagging the name mismatch as a real, if small, doc-drift finding — the issue template
  should reference the Skill's real name). Entries #9, #10, #13, #19, #20, #21, #26 all directly
  inform this proposal's design (memory budget, stdin-forwarding in SSH heredocs, curl timeout
  discipline, smoke-test retry windows).

## 4. Skills loaded
- `engineering/docker-pnpm-monorepo-deploy` (see §3 — the real Skill behind the issue's own
  "engineering/deployment" reference).
- `engineering/testing` — general test-plan discipline; no new automated test framework needed
  here (this feature's own "tests" are a live rehearsal against real infrastructure, not unit/e2e
  specs).

## 5. Assumptions & autonomous decisions
- **ADR-0044's own scope cuts as one coherent v1 boundary** (scratch-container restore drill, not
  PITR/replication; git-SHA tagging + app-image-only rollback, not database-schema rollback; no
  multi-AZ/multi-region/automated failover) — flagged together as §10 question 1.
- **The restore drill never touches the live database.** Every restore target is a disposable
  scratch container, destroyed after its check regardless of pass/fail — no autonomous decision
  here overrides this; it's treated as a hard constraint, not a risk to weigh.
- **Rollback is application-image-only, never a database migration reversal.** Flagged as §10
  question 2 — this is the proposal's own reading of "rollback of a production deploy" against
  what this repo's actual deploy workflow does, not an assumption to slip past without a decision.
- **The rollback rehearsal itself (proving <5 minutes, end to end) requires actually triggering
  `rollback-staging.yml` against the real staging droplet once**, briefly stopping and restarting
  the real `api`/`web` containers there (the same disruption profile any real deploy already has —
  staging exists for exactly this). Flagged as §10 question 3, since it's a real, if brief and
  fully reversible, live-infrastructure action, not something to execute without explicit sign-off.
- **Real finding during implementation, caught only by querying the live staging database directly
  before trusting the sanity-check design (2026-08-11):** the original draft of this proposal (and
  ADR-0044) named `tenant`/`test_definition`/`patient` as the drill's 3 sanity-check tables. A live
  query against the real staging database showed `tenant=0` and `patient=0` — this is a genuinely
  pre-launch environment with no onboarded tenant and no registered patient yet, not a bug. A drill
  checking those two tables would fail on every single run regardless of whether the restore
  actually worked. Fixed before the drill was ever run for real: swapped to
  `test_definition`/`analyte`/`code_system_value`, all three confirmed live to be reliably
  populated by the seed catalogs this environment already has loaded.

## 6. Risks
- **A second, even briefly-resident Postgres container on a 1vCPU/1GB box with an already-tight
  memory budget** (`docker-pnpm-monorepo-deploy` Skill entry #13: 848Mi of ~961Mi already committed
  across the 5 existing services) risks the same OOM class of incident that entry documents.
  Mitigated by: a small, explicit `mem_limit` on the scratch container, running only briefly
  (restore → check → teardown, not left resident), scheduled at 03:30 UTC when the droplet's real
  request load is at its lowest, and relying on the swap this repo already added as the documented
  safety net for exactly this kind of brief overshoot.
- **A rollback rehearsal that crosses a breaking schema-migration boundary would not actually be
  safe** — this proposal's own scope explicitly excludes database rollback, so the rehearsal itself
  must be performed between two deploys that did *not* ship a breaking migration, or the rehearsal
  proves nothing real. Documented directly in `rollback-staging.yml`'s own header comment, not just
  here.
- **GHCR storage grows unbounded** now that every deploy adds a new SHA-tagged image alongside
  `:latest` (previously only `:latest` ever existed, so old layers were implicitly abandoned/GC'd
  by the registry's own untagged-image policy; a SHA tag keeps each version referenced
  indefinitely). Accepted for v1 — GitHub Container Registry storage for a project this size is
  not a real cost concern yet; a retention policy (e.g. delete SHA tags older than N deploys) is
  real, easy future work if it ever becomes one, not attempted here.

## 7. Acceptance criteria
- [ ] `restore-drill.sh` runs on a real cron schedule on the staging droplet and, run for real,
      successfully restores the most recent backup into a scratch container, passes its sanity
      check, and tears the scratch container down — with the live `lis` database provably
      untouched (its own row counts unchanged before/after).
- [ ] Every image `deploy-staging.yml` builds is confirmed live (via `gh api` or the GHCR UI, after
      a real deploy) to carry both `:latest` and `:<git-sha>` tags.
- [ ] `rollback-staging.yml` exists, is `workflow_dispatch`-only, and a real rehearsal run (current
      `main`'s SHA → the immediately-prior deployed SHA) completes and passes the existing smoke
      tests in under 5 minutes wall-clock.
- [ ] `rollback-staging.yml` never runs the migrate/seed/Keycloak-realm steps — confirmed by
      reading the workflow, not just by it happening to not fail.
- [ ] The existing `deploy-staging.yml` behavior is unchanged for every case except the two new
      tags — a normal `main` push still deploys exactly as it does today.

## 8. Testing plan
- No new unit/e2e specs — this feature's own correctness is provable only against real
  infrastructure (a shell script's cron behavior, a GitHub Actions workflow's real run, a real
  droplet's real memory/network behavior), matching this repo's own precedent for infra-only
  features (no test framework invented for something that isn't application code).
- Live rehearsal (the actual acceptance proof, not a stand-in for it):
  1. Trigger `restore-drill.sh` manually once via SSH first (not waiting for the 03:30 cron), watch
     it restore, check, and tear down cleanly; confirm the live database's own row counts are
     identical before and after.
  2. Install the cron entry, confirm it fires on schedule the same way `backup-staging-db.sh`'s own
     entry already does.
  3. Deploy current `main` (a real, ordinary deploy). Note its SHA.
  4. Deploy one more trivial change (or re-trigger with a no-op) to get a second, later SHA
     deployed.
  5. Trigger `rollback-staging.yml` with the earlier SHA as input. Time it start to smoke-test-green.
  6. Confirm the app is genuinely running the earlier SHA's image afterward (not just "the workflow
     succeeded") — check the running container's own image digest on the droplet.
  7. Re-deploy `main` normally afterward, returning staging to its real current state.

## 9. Rollback plan
Every piece here is additive to the existing deploy pipeline (two new scripts, one new workflow,
one new tag per existing image) — nothing existing is removed or restructured.
`deploy-staging.yml`'s own existing behavior for a normal `main` push is unchanged. If
`restore-drill.sh`'s cron entry ever causes a real problem (e.g. an unexpected resource
contention), removing its crontab line is a one-command, fully reversible fix, identical in shape
to removing `backup-staging-db.sh`'s own entry. `rollback-staging.yml` is inert unless manually
triggered — deleting the file removes it with zero effect on the normal deploy path.

## 10. Questions requiring human approval
1. **Approve ADR-0044's scope cuts as one coherent v1 boundary** — a scheduled scratch-container
   restore drill (not PITR/replication), git-SHA image tagging plus application-image-only
   rollback (not database-schema rollback), no multi-AZ/multi-region/automated failover — with
   each deferred piece tracked as real future work, not silently dropped?
2. **Approve "rollback of a production deploy" being scoped to application images only** (redeploy
   a prior `api`/`web` image; never a database migration reversal or Keycloak realm rollback) — the
   proposal's own reading of the literal AC against what this repo's actual deploy workflow does?
3. **Approve performing the rollback rehearsal for real against the live staging droplet once**
   (briefly stopping and restarting the real `api`/`web` containers there, then redeploying `main`
   normally afterward to restore staging's real current state) — the only way to actually prove the
   AC's own "completes within 5 minutes" claim, as opposed to a rehearsal that only exists on
   paper?
