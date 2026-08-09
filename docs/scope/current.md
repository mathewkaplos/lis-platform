# Status — 2026-08-09 (session 27)

Last commit on main: `09b621f` (`lis-platform`) / `efa98a5` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction (a breadcrumb commit can never state its own SHA) — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## `/orient` picked issue #390 over kicking off any of M5's three unstarted features — small,
self-contained, and now cheap because of TASK-400's already-shipped mechanism

Session opened with `/orient`. M5's milestone signals agreed cleanly this time (breadcrumb, GitHub
Milestones, and each of FEAT-022/#31, FEAT-024/#33, FEAT-025/#34 confirmed still "Not Started," zero
comments, no drift) — unlike prior sessions, no stale-signal correction was needed. `engineering-radar` found no new load-bearing gap this time (tech-debt grep, SSH IP, doc-path
drift all clean; GraphQL quota had briefly hit 0/5000 mid-orientation from other sessions' usage, but
the hourly window reset before it blocked anything real).

Rather than start any of M5's three remaining feature kickoffs (each still needs its own multi-step
research → proposal → ADR cycle, no ready-to-`/develop` task for any of them), the session picked
issue #390 ("No 'QC-held' indicator on the result-entry screen") — small, self-contained, and
**already cheap**: TASK-400 (session 26) had made `FinalizationRollupInterceptor`'s QC-hold branch
throw the same `panel_hold`/`reason: 'qc_violation'` signal as the critical-hold branch, but
`apps/web` never consumed `reason` at all — a pure frontend follow-up, no backend change, no new ADR.

**TASK-390 (docs/plans/task-390-qc-held-indicator-result-entry.md, APPROVED same session) implemented
and merged — `lis-platform` PR #405, closing #390.** `actions.ts`'s `PanelHoldProblem`/
`ResultActionOutcome` now parse and thread `reason` through `finalizeResult()`; `results-grid.tsx`'s
held caption branches on it — `qc_violation` gets a new "Saved — held on a QC violation. See QC
violations →" caption with a working `next/link` to `/qc-violations` (confirmed reachable by a
technologist-roled session — that route has no capability gate, only `resolve_qc` itself does);
`unacknowledged_critical` is byte-for-byte unchanged from TASK-400's own caption (its own resolution
affordance, Verify, is already on the same grid — no cross-page pointer needed there).

Verified via a live headless-browser pass (real dev server, real Postgres/Keycloak, technologist-
roled session): a fresh synthetic-analyte QC violation held a panel, the new caption + link appeared
and correctly navigated to `/qc-violations` showing the real violation; a Sodium critical-hold panel
confirmed the unacknowledged-critical caption is unchanged. Both in light and dark mode, zero console
errors. `pnpm typecheck`/`lint`/`test` (web) all pass; no backend files touched (`qc-gate.e2e-spec.ts`
already asserted `reason: 'qc_violation'` at the API level, from TASK-400).

## `/close`'s own Engineering Flow Retrospective found one real process gap, fixed the same session

**A `web-verify` script that pre-seeds a "held"/transient UI outcome via direct API calls, then just
loads the page, will never see it.** TASK-390's held caption is a pure `useState` set only inside
`handleKeyDown`'s `finalizeResult()` callback — a fresh Server Component render reads the row's real
persisted `observationStatus` from the DB, which has no memory of *why* a panel is held. A first
verification attempt pre-seeded the QC violation *and* called `finalize()` directly via HTTP, then
navigated fresh — the caption never appeared, not because the fix was broken, but because nothing
ever exercised the client-side code path that sets it. Fixed by seeding only the precondition (a
fresh not-yet-finalized order) and driving the real interaction (`input.fill()`/`press('Enter')`)
through Playwright itself. Documented as a new gotcha in `web-verify`'s own SKILL.md (this generalizes
to any client-only, non-persisted UI state — a toast, an inline "just saved" banner, any
optimistic-update flash) — `lis-platform` PR #406.

**Manual Verification Checklist:** TASK-390's QC-held caption (the new "See QC violations →" link)
was verified this session via a scripted headless-browser pass in both light and dark mode
(screenshots taken, zero console errors) — a human's own independent click-through of a real QC-held
panel on `/orders/:id/results` is still recommended, not yet confirmed done as of this breadcrumb.

**Next session:** M5's three remaining open features (FEAT-022 Worklist v2, FEAT-024 Peripheral film
structured reporting, FEAT-025 Delta checks) each still need their own kickoff (research → proposal →
ADR) before implementation — none has a ready-to-`/develop` task yet. Issue #381 (no QC/control-lot
list screen) may already be effectively resolved by TASK-070's `/qc-violations` screen (its own filed
text says as much, "folding in #381") but is still open on GitHub — worth reconciling (close or
re-scope) at the next session's own `/orient` rather than assuming either way.
