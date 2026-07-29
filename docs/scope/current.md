# Status — 2026-07-30

## What's actually done (per real evidence)

- **M0 — Foundation & Walking Skeleton is CLOSED** (18/18 issues, closed 2026-07-29T21:22:58Z). Confirmed via `gh api repos/mathewkaplos/lis-platform/milestones` this session, not assumed.
- **#64/#10 closed** via PR #139 ("Closes #64", "Closes #10") — TASK-005 AC1 (Docker Compose reachability) verified with real command output (`docker compose ps` both `Up`, `pg_isready` accepting connections, `valkey-cli ping` → `PONG`). AC2 (`pnpm db:reset` migrate+seed) is deliberately deferred to FEAT-004/#13 (M1), not silently dropped — `db-reset.sh` says so explicitly in its own output.
- **#11 (FEAT-002), #12 (FEAT-003) closed** — both M0-scoped, closed alongside the rest of the M0 sweep.
- **#69 (TASK-010, Sentry + correlation IDs) closed** — see prior session's four-cause root-cause chain (NestJS wiring, stale SSH IP, placeholder Sentry DSN, missing `workflow_dispatch`).
- Session-start, feature-development, and recovery playbooks in `lis-engineering/playbooks/` are in active use — this file's rewrite is a direct product of running the checklist end to end this session.

## Currently active milestone

**M1 — Domain Core & Database Spine** (18 open issues, 0 closed, confirmed via GitHub Milestones API 2026-07-30). This is now the active milestone — a prior version of this file incorrectly still described M0 as active; that was corrected this session after cross-referencing GitHub Milestones directly.

Highest-priority open items in M1:
- **#74** — TASK-015: Constitution CI gate. Code exists (`.github/workflows/constitution-gate.yml`) but has never been exercised against a real migration. Do not close on a green CI check alone.
- **#75** — TASK-016: Migration `analyte`/`unit`/`code_system_value` — the first real migration in M1, currently recommended as the next task (see below).
- **#132** — Prove the Constitution gate actually blocks a bad migration. Blocked on #75 (M1's first migration) landing.
- **#13, #14, #15, #16** — FEAT-004 through FEAT-007, all M1, all "Not Started."

## Open discrepancy — needs a human decision, not yet resolved

**EPIC-001 (#1) was closed on 2026-07-29T21:22:57Z** (manually, by mathewkaplos, not via a merged PR's "Closes #1") in the same batch as the M0 wrap-up. Its own issue body explicitly states milestones **M0, M1** and its Definition of Done says "Epic closed only after its terminating milestone's (M1) exit criteria are met" — with FEAT-004 through FEAT-007 still listed unchecked. This looks like a premature/accidental closure swept up with the legitimate M0 close-out, surfaced during this session's orientation. **Not yet resolved** — awaiting a decision on whether to reopen #1 or treat the DoD wording as superseded.

## Next recommended task, and why

**TASK-016 (#75)** — first M1 migration. Dependencies (TASK-005) are satisfied. It retires the one open tech-debt marker in the repo (`db-reset.sh`'s "NOT YET IMPLEMENTED: migrate + seed"), and it is also the prerequisite for exercising #74/#132 — the Constitution gate has existed since M0 but has never been tested against real migration content. Per AGENTS.md Rule #0 and TASK-016's own Definition of Done, a **FEAT-004 Implementation Proposal** is required and must be approved before any migration code is written.

## Notes / gotchas for the next session

- **"Code merged" and "acceptance criterion proven" are different facts — this cost real time in a prior session (TASK-010 had four independent root causes, each looking identical to an outside observer).** Apply the same skepticism before closing #74/#132 — a green CI run on the Constitution gate is not the same as proof it blocks a bad migration.
- The Sentry MCP (official `getsentry/sentry-mcp` plugin, OAuth-based) is connected and working — use it directly for Sentry verification.
- `deploy-staging.yml` has a `workflow_dispatch` trigger — use `gh workflow run deploy-staging.yml` for secret-only redeploys, no dummy commit needed.
- SSH firewall allowlists exactly one IP at a time and it drifts with ISP address rotation. Checked this session: `curl ifconfig.me` (`105.161.1.147`) matches `infra/terraform.tfvars` (`105.161.1.147/32`) exactly — no drift right now, but re-check if SSH ever times out with no other symptom.
- Watch for PRs that merge code without a "Closes #NN" reference — this has silently left tracking issues open before (#133/#64 pattern from a prior session).
- This repo lost work once to an accidental `git reset --hard` (recovered in PR #125) — stay cautious with destructive git operations.
- `docker` is not on PATH in this WSL distro by default — needs Docker Desktop running on Windows with WSL integration enabled.
- The `skills/workflow/engineering-radar/SKILL.md` Skill (in `lis-engineering`) was run for the first time this session as part of orientation — found no new drift beyond what's captured above. Worth running every session going forward now that it's proven out.
- No `research/index.md` exists at either location referenced by the playbooks (`lis-engineering/research/index.md` or `/mnt/d/LIS/research/index.md`) — the "research inbox" concept has no maintained index right now. Not blocking, but orientation can't currently tell what's "unprocessed since last session" in research.
- All figures above are current as of 2026-07-30, gathered directly from `gh api`/`gh issue view`/`gh pr view` this session — re-verify against GitHub directly if much time has passed rather than trusting this file blindly.
