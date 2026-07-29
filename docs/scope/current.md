# Status — 2026-07-27

## What's actually done (per real evidence)

- Terraform gitignore, lockfile, and variable definitions added for infra (PR #134, merged 2026-07-27).
- Sentry error tracking and request correlation IDs wired into the API bootstrap, including a temporary `/debug-sentry` endpoint for verification (PR #133, merged 2026-07-27). This matches the acceptance criterion for TASK-010, but the tracking issue (#69) has not been closed — see gotchas below.
- CI deploy to staging rerouted over Tailscale instead of public SSH, fixing a DigitalOcean firewall 1000-source-IP limit that was breaking deploys (PR #131, merged 2026-07-26).
- `pnpm-lock.yaml` regenerated to match the `injectWorkspacePackages` setting, fixing a lockfile/config mismatch that was blocking deploy (PR #130, merged 2026-07-26).
- Missing Dockerfiles created and pnpm v11 + Docker build issues fixed, including `CI=true` and Next.js standalone output (PR #129 and #128, merged 2026-07-26).
- Merge-to-staging deploy pipeline with a smoke test added, covering TASK-009 (PR #127, merged 2026-07-26).
- M0 cross-package build wiring restored after being lost to an accidental `git reset --hard` (PR #125, merged 2026-07-26) — recovering the fix from PR #124 (merged 2026-07-26), which originally addressed TASK-001 and TASK-004.
- Health endpoint response formatting cleaned up to satisfy Prettier (PR #123, merged 2026-07-26).
- Docker Compose for Postgres 16 + Valkey exists at the repo root (`docker-compose.yml`), matching TASK-005, though the tracking issue (#64) remains open — see gotchas below.
- A Constitution CI gate (`.github/workflows/constitution-gate.yml`) exists, matching TASK-015, though the tracking issue (#74) remains open and its real effectiveness is unverified — see gotchas below.

## What's genuinely still open in the current milestone

The only milestone with any closed issues is **M0 — Foundation & Walking Skeleton** (12 closed / 7 open per the milestones API), so it is the current one. All other milestones (M1–M10) have 0 closed issues.

The 7 open M0 issues:
- **#74** — TASK-015: Constitution CI gate (invariant enforcement). Code exists but is unproven (see #132).
- **#69** — TASK-010: Sentry + structured logging with correlation IDs. Code appears merged (PR #133); issue just needs verification against its acceptance criterion and closing.
- **#64** — TASK-005: Docker Compose Postgres 16 + Valkey; db:reset. Code exists (`docker-compose.yml`); issue needs verification and closing.
- **#12** — FEAT-003: AI engineering substrate (feature-level rollup, parent of #74).
- **#11** — FEAT-002: CI/CD & environments (feature-level rollup, parent of #69).
- **#10** — FEAT-001: Monorepo & toolchain (feature-level rollup, parent of #64).
- **#1** — EPIC-001: Platform Foundation (epic-level rollup over all of the above).

Additionally, **#132** — "Prove the Constitution gate actually blocks a bad migration (never yet exercised)" — is open but has **no milestone assigned**, despite being discovered "during M0 close-out" and directly bearing on #74. It states the gate has passed every PR so far only because `db/migrations/` has never existed, so it has had zero real content to check. It explicitly says this can't be proven until TASK-016 (#75, first M1 migration) lands.

## Next recommended task, and why

M0's stated goal is "Foundation & Walking Skeleton," and at 12/19 closed it's nearly done — the remaining real (non-rollup) work is two issues (#69, #64) that already have matching code merged or present in the repo, plus one (#74) that cannot be honestly closed yet. The most useful next step is to verify #69 and #64 against their written acceptance criteria and close them, since that's bookkeeping rather than new build and will make M0's true remaining surface visible. #74 should stay open with #132's caveat attached rather than being closed on the strength of a green CI check, since #132 is explicit that the gate has never been tested against real content — closing #74 now would create false confidence that M0's invariant-enforcement goal is met.

## Notes / gotchas for the next session

- `docs/scope/current.md` did not exist before this file. The `docs/scope/` directory was present but empty, and `git log --all -- docs/scope/` returns nothing — this is a first write, not a recreation of something lost. Verify it stays current from here on rather than assuming it's stale.
- PRs #133 (Sentry) and the existing `docker-compose.yml` both implement work matching open issues #69 and #64, but neither PR referenced "Closes #NN," so GitHub never auto-closed them. Check for this pattern generally — merged code and open tracking issues can silently diverge here.
- Don't trust a green Constitution gate as proof it works. Per #132, `constitution-gate.yml` has had nothing real to reject yet because no migrations exist. It becomes meaningful only once TASK-016 (#75, M1) lands the first migration — deliberately test it against a bad one (free-text clinical column, missing RLS) at that point.
- #132 has no milestone. Consider assigning it to M0 or M1 explicitly so it doesn't fall through tracking between the two.
- This repo already lost work once to an accidental `git reset --hard` (recovered in PR #125) — a concrete reason to be cautious with destructive git operations here.
- All figures above are current as of 2026-07-27. This project is moving fast (10 PRs merged in the two days prior to this snapshot) — re-run the Step 1 queries before trusting this file if much time has passed.
