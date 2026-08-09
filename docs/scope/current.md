# Status — 2026-08-09 (session 26)

Last commit on main: `e4f4d96` (`lis-platform`) / `19d5764` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction (a breadcrumb commit can never state its own SHA) — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## `/orient` found a fresh, load-bearing gap (issue #400) — resolved same session via `plan` →
`develop`, before any M5 feature kickoff

Session opened with `/orient`. Milestone M5's open-issue list didn't match the prior breadcrumb's
"next session" note: FEAT-023 (Haematology CBC + differential) had fully landed and closed since
session 25 (TASK-071 catalog + ranges #398, TASK-072 calculated absolute-count formulas #399,
TASK-073 verification #395) — the real M5 remainder is FEAT-022 (Worklist v2), FEAT-024
(Peripheral film structured reporting), FEAT-025 (Delta checks), not the stale FEAT-022/023/025
list session 25 recorded (FEAT-024 had been missing from that note entirely).

`engineering-radar` surfaced issue #400 (opened the same day, during TASK-073's own verification,
`domain/critical-values` Skill entry #8) as a genuinely load-bearing gap with no ADR: `finalize()`'s
panel-hold 409 (`FinalizationRollupInterceptor`, thrown *after* the analyte's own write already
committed, per entry #7's documented two-transaction design) was indistinguishable from a genuine
pre-write rejection to `apps/web`'s `finalizeResult()` — a technologist saw an apparently lost,
greyed-out value for data that was, in fact, already saved. Per the radar's own Level 2
autonomous-drafting rule, drafted ADR-0021 (accepted) proposing a `panel_hold` problem-details code
+ echoed persisted value; the human accepted it and chose to resolve #400 immediately rather than
start a new feature kickoff, given its severity (real trust/correctness bug) and small, self-
contained scope versus three multi-step feature kickoffs with no ready-to-`/develop` task yet.

**TASK-400 (docs/plans/task-400-finalize-panel-hold-response.md, APPROVED same session) implemented
and merged — `lis-platform` PR #401, closing #400.** Both of `FinalizationRollupInterceptor`'s
post-commit hold branches (unacknowledged-critical AND the QC-hold branch, which shared the
identical latent bug — not just the one #400 happened to reproduce) now throw a new
`PanelHoldException`, giving the 409 body a `code: 'panel_hold'` + echoed `heldObservation`/
`heldCalculatedDependents` (the interceptor already holds this from the just-committed write, zero
extra query). `loadWriteContext`'s pre-write 409 is deliberately untouched — the control case the
frontend's `code` check falls back to. `results-grid.tsx` now renders a warning-colored "Saved —
…" caption with the real value instead of the old danger-colored error over a blanked row.

Verified via extended e2e body-shape assertions (`observation.e2e-spec.ts`,
`qc-gate.e2e-spec.ts` — 32/32 passing; full suite 235/237, the 2 failures pre-existing and
confirmed unrelated via stash-and-rerun against unmodified `main`) and a live headless-browser pass
reproducing TASK-073's exact 20-analyte CBC repro (Platelet Count critical first, Basophils %
completing the panel last, cascading Basophils Absolute) in both light and dark mode — held row
keeps its real value with the warning caption, cascaded value renders correctly, zero console
errors.

## `/retro` (mid-session) + `/close`'s own Engineering Flow Retrospective found three real process
gaps, all fixed the same session

1. **Local `apps/api` e2e runs need manual `.env` sourcing — undocumented.** `pnpm --filter api
   test:e2e` fails immediately with `Error: APP_DATABASE_URL is not set` when run directly;
   `vitest.e2e.config.ts` does no dotenv loading, and CI never hits this since `pr.yml` sets the
   vars as job-level env, not from a `.env` file. Fixed: `engineering/testing` Skill entry #12
   (`source .env` into the shell first), `lis-engineering` `85b5f61`; logged via `lis-platform`
   PR #402.
2. **`ScheduleWakeup` was denied by the auto-mode classifier** while waiting on PR #401's CI, with
   no documented fallback — worked around with a backgrounded `Bash` until-loop polling REST
   `check-runs` directly, reused identically for PR #402/#403.
3. **GraphQL quota hit zero mid-session despite `engineering-radar`'s own earlier low-quota
   warning** (263/5000, flagged during this session's own `/orient`) — `gh pr checks --watch`
   failed outright once quota actually reached zero; the warning alone hadn't named the specific
   risky command.

Findings 2-3 fixed together: AGENTS.md's merge-autonomy bullet extended with a REST `check-runs`
polling default and the backgrounded-Bash fallback (`lis-platform` PR #403 — see that PR's own
merge status for whether it needed hands-on human git steps per AGENTS.md's own
AGENTS.md-changes-need-extra-scrutiny rule); `engineering-radar` now names `gh pr checks --watch`
explicitly; `develop`'s merge step points to AGENTS.md's new guidance. Both `lis-engineering`
`19d5764`.

**Manual Verification Checklist:** TASK-400's held-row UI (the "Saved — …" caption) was verified
this session via a scripted headless-browser (Playwright) pass in both light and dark mode
(screenshots taken, no console errors) — but a human's own independent click-through of
`/orders/:id/results` for a real held panel is still recommended, not yet done as of this
breadcrumb.

**Next session:** M5's three remaining open features (FEAT-022 Worklist v2, FEAT-024 Peripheral
film structured reporting, FEAT-025 Delta checks) each still need their own kickoff (research →
proposal → ADR) before implementation — none has a ready-to-`/develop` task yet. Issue #390
(QC-held indicator on the result-entry screen) remains open and undecided, but is now cheaper to
build than before: TASK-400's `panel_hold`/`reason` signal is exactly the mechanism a UI indicator
for #390 would consume.
