# Status — 2026-07-30

## What's actually done (per real evidence)

- **M0 — Foundation & Walking Skeleton is CLOSED** (18/18 issues). Unchanged since last refresh.
- **FEAT-004 (Catalog metadata model) is CLOSED — all four tasks merged, issue #13 closed this session:**
  - **TASK-016 (#75, PR #144)** — `analyte`, `unit`, `code_system_value`. Global reference tables per ADR-0004 (no RLS by design).
  - **TASK-017 (#76, PR #147)** — `test_definition`, `test_analyte`, `panel`, `panel_test`. Tenant-scoped with RLS. This PR also discovered and fixed a real bug: `postgres` is a `BYPASSRLS` superuser and both compose files connected the API as `postgres`, making every RLS policy up to that point a structural no-op regardless of content. A non-superuser `lis_app` role now exists and the API connects as it instead.
  - **TASK-018 (#77, PR #148)** — `reference_range` (sex/age/method/criticals/versioned, KB-15's multi-dimensional model). Verified for real: specificity-based resolution returns the correct row for a 45-year-old male test case (AC met), and RLS was proven to actually isolate when connected as `lis_app` (wrong/no-data tenant sees 0 rows).
  - **TASK-019 (#78, PR #150)** — the design-partner blocker flagged in the prior breadcrumb was resolved: no named partner or real test-menu data exists in either repo, so the decision made was to seed a standard, genuinely real, LOINC/UCUM-coded Comprehensive Metabolic Panel (14 analytes, sex-specific and critical-threshold reference ranges), explicitly labeled a placeholder (not partner data) in the seed file header and every `reference_range.source` value. `scripts/db-reset.sh`'s last `NOT YET IMPLEMENTED: seed` marker is retired. CMP panel resolves to all 14 constituent analytes in one query; RLS still isolates as `lis_app`.
- **FEAT-005 (Observation store, #14) Implementation Proposal is APPROVED (PR #151).** Covers TASK-020/021/022 under one proposal (FEAT-004's precedent). All four open questions resolved and recorded as new ADRs:
  - **ADR-0005** (accepted) — forward-referencing columns (`ordered_test_id`/`specimen_id`/`patient_id`) are required `uuid` now, FK backfilled once the referenced tables land in TASK-023 (#82) / TASK-038 (#97); forward-linking comments already posted on both.
  - **ADR-0006** (accepted) — `observation.data_type` is a native Postgres `ENUM`, not `text`.
  - Proposal file: `docs/plans/feat-005-observation-store.md`. TASK-020 (#79) is its immediate, concrete scope — no further proposal needed to start it.
- **#132 (Constitution gate proof) is legitimately closed — verified with real CI evidence, not just a green check.** During TASK-017's PR #147, a deliberately-broken migration commit (a tenant-scoped table with no RLS policy) was pushed and the Constitution Gate **failed** on it (real CI run, commit `d7545410`); a revert commit was then pushed and the gate **passed** (commit `e41e78aa`). Both runs are on record via `gh run list`. This directly answers the "code merged ≠ acceptance criterion proven" gotcha — do not re-litigate this closure without re-reading that CI history first.
- **EPIC-001 (#1) is currently OPEN.** Unchanged since last refresh — no outstanding action.

## Currently active milestone

**M1 — Domain Core & Database Spine** (13 open issues, 5 closed: #75, #76, #77, #78, #132 — confirmed via GitHub Milestones API 2026-07-30; supersedes the prior count of "14 open, 4 closed").

Highest-priority open items in M1:
- **#79 (TASK-020)** — Migration: `observation` (type-partitioned values). Next task, in progress this session. See FEAT-005 proposal above for scope; ADR-0005/0006 govern its schema decisions.
- **#80 (TASK-021)** — Append-only enforcement + `result_history`. Follows TASK-020 under the same approved proposal.
- **#81 (TASK-022)** — Partitioning + trend indexes on `observation`. Follows TASK-021.
- **#74** — TASK-015: Constitution CI gate. Code exists and is proven to work (see #132 above); the issue itself is still open (real remaining work, not just bookkeeping). Its stale `milestone:m0` label was corrected to `milestone:m1` this session.
- **#145** — Design an ADR-based RLS-exemption mechanism for the Constitution gate. Still not urgent — no *global* (exempt) tenant table has been introduced yet; `reference_range` and `observation` are both genuinely tenant-scoped. Milestone M1 was assigned this session so it no longer falls out of backlog tracking.

## Notes / gotchas for the next session

- **"Code merged" and "acceptance criterion proven" are different facts.** Confirmed again as a real, recurring risk class (see #132 above) — keep applying this skepticism.
- `lis_app` (non-superuser, `NOBYPASSRLS`) is the correct role to connect as for any RLS verification going forward; `postgres` is migrations-only and will silently no-op any RLS test.
- **Real SSH firewall IP drift found this session:** current egress IP did not match `infra/terraform.tfvars`'s `ssh_allowed_ip`. A fix was drafted (and, depending on this session's outcome, may already be applied via `tofu apply` — check `terraform.tfvars` and recent `tofu` runs directly rather than trusting this line, since apply requires a separate explicit approval each time). This is the known recurring risk class flagged in the engineering-radar Skill — keep checking it every session.
- `docker` is not on PATH in this WSL distro by default — needs Docker Desktop running on Windows with WSL integration enabled. `docker compose down -v` between verification runs is the established clean-teardown pattern.
- The engineering-radar Skill picked up a proposed (uncommitted, as of this session's start) "Level 2 auto-remediation drafting" addition for the SSH IP check — check `lis-engineering` git status for whether it was committed or discarded.
- No `research/index.md` exists at either location (`lis-engineering/research/index.md` or `/mnt/d/LIS/research/index.md`) — `/mnt/d/LIS/research` itself is not empty (it's the full 56-doc KB source), it just has no "unprocessed since last session" index. Not blocking.
- All figures above are current as of 2026-07-30, gathered directly from `gh api`/`gh issue view`/`gh pr view`/`gh run list` this session — re-verify against GitHub directly if much time has passed rather than trusting this file blindly.
