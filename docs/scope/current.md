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
  - Proposal file: `docs/plans/feat-005-observation-store.md`.
- **TASK-020 (#79, PR #153) is merged and closed** — the `observation` table (KB-06's "heart of the schema"), per ADR-0005/0006. Verified for real against a running Postgres instance, connected as `lis_app`: quantity/coded/text observations persist with only the matching typed column populated (AC); a mismatched `quantity` row with no `value_num` is rejected by its CHECK constraint; an invalid `data_type` is rejected by the ENUM itself; RLS isolates (wrong tenant 0 rows, correct tenant its own rows); `ref_low`/`ref_high` snapshot values on an observation stay unchanged even after the source `reference_range` row is later updated (KB-06/KB-14's "snapshot, never recompute" rule).
  - **This PR also found and fixed a real Constitution Gate bug**, same class as TASK-017's `postgres`/`BYPASSRLS` discovery: the gate's pathspec `db/migrations/*` also matched Drizzle's auto-generated `meta/*.json` snapshot files (git pathspec globs cross `/`). That JSON serializes CHECK-constraint SQL as strings, and the free-text-column check's naive regex flagged `"value": "(...<> 'text')...value_text..."` in `meta/0004_snapshot.json` as a clinical free-text column violation — a false positive; no such column exists (`data_type` is a proper ENUM, `value_text` is a CHECK-constrained typed column). Fixed by scoping both `check-invariants` steps to `db/migrations/*.sql`. Confirmed via real CI: the run failed before the fix (run `30527085563`) and passed after it (run `30527513935`) with no other change to the migration.
  - TASK-021 (append-only + `result_history`) and TASK-022 (partitioning + trend indexes) follow under this same approved proposal.
- **#132 (Constitution gate proof) is legitimately closed — verified with real CI evidence, not just a green check.** During TASK-017's PR #147, a deliberately-broken migration commit (a tenant-scoped table with no RLS policy) was pushed and the Constitution Gate **failed** on it (real CI run, commit `d7545410`); a revert commit was then pushed and the gate **passed** (commit `e41e78aa`). Both runs are on record via `gh run list`. This directly answers the "code merged ≠ acceptance criterion proven" gotcha — do not re-litigate this closure without re-reading that CI history first.
- **EPIC-001 (#1) is currently OPEN.** Unchanged since last refresh — no outstanding action.

## Currently active milestone

**M1 — Domain Core & Database Spine** (12 open issues, 6 closed: #75, #76, #77, #78, #79, #132 — confirmed via GitHub Milestones API 2026-07-30; supersedes the prior count of "13 open, 5 closed").

Highest-priority open items in M1:
- **#80 (TASK-021)** — Append-only enforcement + `result_history`. Next task. Follows TASK-020 under the same approved FEAT-005 proposal; needs `previous_observation_id`/`amendment_of` (already present on `observation` from TASK-020) to enforce against.
- **#81 (TASK-022)** — Partitioning + trend indexes on `observation`. Follows TASK-021.
- **#74** — TASK-015: Constitution CI gate. Code exists and is proven to work (see #132 above); the issue itself is still open (real remaining work, not just bookkeeping). Its stale `milestone:m0` label was corrected to `milestone:m1` this session.
- **#145** — Design an ADR-based RLS-exemption mechanism for the Constitution gate. Still not urgent — no *global* (exempt) tenant table has been introduced yet; `reference_range` and `observation` are both genuinely tenant-scoped. Milestone M1 was assigned this session so it no longer falls out of backlog tracking.

## Notes / gotchas for the next session

- **"Code merged" and "acceptance criterion proven" are different facts.** Confirmed again as a real, recurring risk class (see #132 above) — keep applying this skepticism.
- `lis_app` (non-superuser, `NOBYPASSRLS`) is the correct role to connect as for any RLS verification going forward; `postgres` is migrations-only and will silently no-op any RLS test.
- **Real SSH firewall IP drift found and fixed this session:** current egress IP (`105.161.147.210`) did not match `infra/terraform.tfvars`'s `ssh_allowed_ip` (was `105.161.1.147/32`, a real one-digit-shifted drift). Fixed and applied via `tofu apply` — the DigitalOcean staging firewall's port-22 rule now allows the current IP. This is the known recurring risk class flagged in the engineering-radar Skill — re-check it every session, since egress IPs change.
- `docker` is not on PATH in this WSL distro by default — needs Docker Desktop running on Windows with WSL integration enabled. `docker compose down -v` between verification runs is the established clean-teardown pattern.
- The engineering-radar Skill picked up a proposed (uncommitted, as of this session's start) "Level 2 auto-remediation drafting" addition for the SSH IP check — check `lis-engineering` git status for whether it was committed or discarded.
- No `research/index.md` exists at either location (`lis-engineering/research/index.md` or `/mnt/d/LIS/research/index.md`) — `/mnt/d/LIS/research` itself is not empty (it's the full 56-doc KB source), it just has no "unprocessed since last session" index. Not blocking.
- All figures above are current as of 2026-07-30, gathered directly from `gh api`/`gh issue view`/`gh pr view`/`gh run list` this session — re-verify against GitHub directly if much time has passed rather than trusting this file blindly.
