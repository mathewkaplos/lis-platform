# Status — 2026-07-29

## What's actually done (per real evidence)

- **TASK-010 (Sentry + correlation IDs) — VERIFIED, closed (#69).** Real root-cause chain, in order: (1) plain `@sentry/node`'s global hooks never fired because NestJS's own `ExceptionsHandler` caught and converted exceptions before they became process-level uncaught errors — fixed by switching to `@sentry/nestjs` with `SentryModule.forRoot()` + `SentryGlobalFilter` registered via `APP_FILTER` (PR #135); (2) a stale SSH-allowlisted IP (`105.164.40.172` vs. the actual current `105.161.33.152`) blocked all droplet access, including verification — fixed by updating `infra/terraform.tfvars` and re-applying; (3) the `SENTRY_DSN` GitHub secret held a literal placeholder string (`"your-sentry-dsn-or-leave-blank-for-now"`) from initial setup, so Sentry's SDK silently no-op'd with no error — fixed by setting the real DSN and redeploying; (4) `deploy-staging.yml` had no `workflow_dispatch` trigger, so a secret-only change couldn't be redeployed on demand — fixed by adding the trigger (PR #136). Final proof: Sentry issue `LIS-BACKEND-NEST-1` ("Error: Sentry test error — TASK-010 verification"), confirmed live via the Sentry MCP, first/last seen matching the test timestamp exactly. The temporary `/debug-sentry` endpoint has been removed (this branch) now that verification is complete.
- Terraform gitignore, lockfile, and variable definitions added for infra (PR #134, merged 2026-07-27).
- CI deploy to staging rerouted over Tailscale instead of public SSH, fixing a DigitalOcean firewall 1000-source-IP limit that was breaking deploys (PR #131, merged 2026-07-26).
- `pnpm-lock.yaml` regenerated to match the `injectWorkspacePackages` setting, fixing a lockfile/config mismatch that was blocking deploy (PR #130, merged 2026-07-26).
- Missing Dockerfiles created and pnpm v11 + Docker build issues fixed, including `CI=true` and Next.js standalone output (PR #129 and #128, merged 2026-07-26).
- Merge-to-staging deploy pipeline with a smoke test added, covering TASK-009 (PR #127, merged 2026-07-26).
- M0 cross-package build wiring restored after being lost to an accidental `git reset --hard` (PR #125, merged 2026-07-26) — recovering the fix from PR #124 (merged 2026-07-26), which originally addressed TASK-001 and TASK-004.
- Health endpoint response formatting cleaned up to satisfy Prettier (PR #123, merged 2026-07-26).
- Docker Compose for Postgres 16 + Valkey exists at the repo root (`docker-compose.yml`), matching TASK-005, though the tracking issue (#64) remains open — see gotchas below.
- A Constitution CI gate (`.github/workflows/constitution-gate.yml`) exists, matching TASK-015, though the tracking issue (#74) remains open and its real effectiveness is unverified — see gotchas below.
- Session-start, feature-development, and recovery playbooks (15 files) written and installed in `lis-engineering/playbooks/`, recreated after an original zip export was lost. Orientation was tested twice on genuinely fresh Claude Code sessions and correctly caught a dirty working tree and a retrospective/milestone inconsistency without prior context.

## What's genuinely still open in the current milestone

M0 — Foundation & Walking Skeleton is the only milestone with any closed issues, and it is now closer to done: **#69 is closed** as of this update. Remaining open, non-rollup issues:

- **#74** — TASK-015: Constitution CI gate (invariant enforcement). Code exists but is unproven (see #132). Do not close on a green CI check alone.
- **#64** — TASK-005: Docker Compose Postgres 16 + Valkey; db:reset. Code exists (`docker-compose.yml`); issue still needs verification against its acceptance criterion and closing — same pattern as #69, verify before trusting.
- **#12, #11** — feature-level rollups, will close once #74/#64 close (#10, parent of #64's toolkit work, may already be closeable — check).
- **#1** — EPIC-001: Platform Foundation (epic-level rollup).

**#132** — "Prove the Constitution gate actually blocks a bad migration (never yet exercised)" — still open, still unmilestoned, still blocked on TASK-016/#75 (M1's first migration). Nothing about this has changed.

## Next recommended task, and why

With #69 now genuinely closed, the only real remaining M0 work is **#64** (verify Docker Compose against its actual acceptance criteria — same "code exists ≠ verified" discipline that #69 just proved matters) and **#74/#132** (which correctly stay open until M1 provides real content to test against). Verifying #64 is the highest-leverage next step: it's bookkeeping, not new build, and it's the last thing standing between M0 and an honest, fully-substantiated close.

## Notes / gotchas for the next session

- **The single biggest lesson from this session: "code merged" and "acceptance criterion proven" are different facts, and conflating them cost real time.** TASK-010 alone had four independent things wrong (NestJS wiring, a stale firewall IP, a placeholder secret, a missing workflow trigger), and every one of them would have looked identical to an outside observer as "no error in Sentry." Only demanding raw evidence at each step — never accepting a narrated "should be working now" — surfaced all four. Apply the same skepticism to #64 before closing it.
- The Sentry MCP (official `getsentry/sentry-mcp` Claude Code plugin, OAuth-based) is now connected and working — use it directly for any future Sentry verification instead of manual `curl`/token wrangling.
- `deploy-staging.yml` now has a `workflow_dispatch` trigger — a secret-only change no longer requires a dummy commit to redeploy; use `gh workflow run deploy-staging.yml`.
- The SSH firewall rule allows exactly one IP at a time, and that IP **will** drift again (ISPs rotate dynamic addresses) — if SSH ever times out again with no other symptom, check `curl ifconfig.me` against `infra/terraform.tfvars` before assuming anything else is wrong.
- PRs #133 (Sentry, now superseded by #135) and the existing `docker-compose.yml` (#64) illustrate the same pattern: merged code with no "Closes #NN" reference, so GitHub never auto-closed the tracking issue. Keep checking for this.
- This repo already lost work once to an accidental `git reset --hard` (recovered in PR #125) — a concrete reason to be cautious with destructive git operations here.
- All figures above are current as of 2026-07-29. Re-run the orientation playbook's Step 1 queries before trusting this file if much time has passed.
