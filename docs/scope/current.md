# Status — 2026-07-30

## What's actually done (per real evidence)

- **M0 — Foundation & Walking Skeleton is CLOSED** (18/18 issues). Unchanged since last refresh.
- **FEAT-004's first three migrations are merged and closed:**
  - **TASK-016 (#75, PR #144)** — `analyte`, `unit`, `code_system_value`. Global reference tables per ADR-0004 (no RLS by design).
  - **TASK-017 (#76, PR #147)** — `test_definition`, `test_analyte`, `panel`, `panel_test`. Tenant-scoped with RLS. This PR also discovered and fixed a real bug: `postgres` is a `BYPASSRLS` superuser and both compose files connected the API as `postgres`, making every RLS policy up to that point a structural no-op regardless of content. A non-superuser `lis_app` role now exists and the API connects as it instead.
  - **TASK-018 (#77, PR #148)** — `reference_range` (sex/age/method/criticals/versioned, KB-15's multi-dimensional model). Verified for real: specificity-based resolution returns the correct row for a 45-year-old male test case (AC met), and RLS was proven to actually isolate when connected as `lis_app` (wrong/no-data tenant sees 0 rows).
- **#132 (Constitution gate proof) is legitimately closed — verified with real CI evidence, not just a green check.** During TASK-017's PR #147, a deliberately-broken migration commit (a tenant-scoped table with no RLS policy) was pushed and the Constitution Gate **failed** on it (real CI run, commit `d7545410`); a revert commit was then pushed and the gate **passed** (commit `e41e78aa`). Both runs are on record via `gh run list`. This directly answers the "code merged ≠ acceptance criterion proven" gotcha flagged in the prior breadcrumb — do not re-litigate this closure without re-reading that CI history first.
- **EPIC-001 (#1) discrepancy is resolved — it is currently OPEN.** The prior breadcrumb flagged a premature/accidental closure; by this session it had already been reopened (by whom/when not confirmed — GitHub shows `closedAt: null`, `state: OPEN`). No outstanding action needed here, but worth a sanity check next time milestone bookkeeping happens in bulk.

## Currently active milestone

**M1 — Domain Core & Database Spine** (14 open issues, 4 closed: #75, #76, #77, #132 — confirmed via GitHub Milestones API 2026-07-30, same day as the prior count of "18 open, 0 closed"; that count is now stale, superseded by this one).

Highest-priority open items in M1:
- **#74** — TASK-015: Constitution CI gate. Code exists and is now proven to work (see #132 above) — but the issue itself is still open, and it carries a **stale `milestone:m0` label** while its actual GitHub Milestone is M1 (label vs. milestone-field mismatch, flagged this session, not yet fixed — trivial but touches shared GitHub state, left for explicit approval).
- **#145** — Design an ADR-based RLS-exemption mechanism for the Constitution gate. Opened during TASK-016/017 (the gate has no way to distinguish "correctly RLS-exempt per an ADR" from "genuinely missing RLS"). **Not urgent for TASK-018/019** — `reference_range` is genuinely tenant-scoped per ADR-0004, not exempt. Becomes relevant again only when a future *global* (exempt) table is introduced. Currently has **no milestone assigned** — should get one so it doesn't fall out of backlog tracking.
- **#78 (TASK-019)** — Seed design partner's real chemistry catalog. **Blocked on a human decision, see below — do not seed fabricated "partner" data.**
- **#13** (FEAT-004) is nearly done (TASK-016/017/018 merged; TASK-019 is its last task). **#14/#15/#16** (FEAT-005/006/007) still "Not Started."

## Open blocker — needs a human decision before TASK-019 can proceed

**TASK-019's premise ("seed the design partner's real chemistry catalog") has no corresponding data anywhere in either repo.** Searched `lis-platform`, `lis-engineering/knowledge-base`, and the full `/mnt/d/LIS/research` corpus: every reference to "design partner" (in `LIS-Execution-Plan.md`, the product backlog, TASK-019/FEAT-004 itself) describes a **future** real lab client whose actual test menu and reference ranges would be captured during design-partner sessions (per the Execution Plan's weekly cadence) — no partner has been named yet, and no concrete test-menu file exists to seed from. Fabricating a named partner or inventing "real" data not actually sourced from a partner would misrepresent provenance in a table whose whole point is `source`/citation-tracked (KB-15, ISO 15189 concerns) and would make the AC ("the partner's actual chemistry test menu is present") false on its face. **Surfaced to the human this session, not yet resolved** — options likely include: (a) seed a standard, genuinely real, LOINC-coded chemistry panel (e.g., a published Basic/Comprehensive Metabolic Panel) explicitly labeled as a placeholder standard-panel, not partner data, until a real design partner is secured; or (b) defer TASK-019 until a design partner exists. Do not silently pick one — this was called out as exactly the kind of decision Rule #0 requires stopping for.

## Notes / gotchas for the next session

- **"Code merged" and "acceptance criterion proven" are different facts.** Confirmed again as a real, recurring risk class (see #132 above) — keep applying this skepticism, don't assume it's now "solved" as a category just because #132 specifically is closed.
- `lis_app` (non-superuser, `NOBYPASSRLS`) is the correct role to connect as for any RLS verification going forward; `postgres` is migrations-only and will silently no-op any RLS test.
- SSH firewall / Sentry MCP / `deploy-staging.yml` workflow_dispatch notes from the prior session are unchanged — see git history of this file if needed; trimmed here to keep this file current rather than cumulative.
- `docker` is not on PATH in this WSL distro by default — needs Docker Desktop running on Windows with WSL integration enabled. `docker compose down -v` between verification runs is the established clean-teardown pattern (see TASK-017/018 PRs).
- The engineering-radar Skill has now been run in two consecutive sessions with no new drift beyond what's captured here or in open issues (#74's label, #145's missing milestone) — keep running it each session.
- No `research/index.md` exists at either location (`lis-engineering/research/index.md` or `/mnt/d/LIS/research/index.md`) — `/mnt/d/LIS/research` itself is not empty (it's the full 56-doc KB source), it just has no "unprocessed since last session" index. Not blocking.
- All figures above are current as of 2026-07-30, gathered directly from `gh api`/`gh issue view`/`gh pr view`/`gh run list` this session — re-verify against GitHub directly if much time has passed rather than trusting this file blindly.
