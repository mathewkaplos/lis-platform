# Status — 2026-08-08 (session 24)

Last commit on main: `892c9d8` — "docs: log retro -- Closes-#N fix recurred despite being live (#372/#373) (#383)".
Two more PRs (#385, #386-or-later) are landing this same session for FEAT-020's kickoff and this
breadcrumb refresh itself — check `git log origin/main -5` for the real current tip, this line will
already be one or two commits behind it by construction (a breadcrumb commit can never state its own
SHA).

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## Session opened with `/orient`, which re-found the exact `Closes #N` bug session 22 already "fixed" —
this time recurring even though the fix was already live

`/orient`'s milestone cross-check (CHECKLIST.md item 9) found #372 (TASK-067) and #373 (TASK-068)
still **open** on GitHub despite PRs #376/#377 being merged. Same root cause as session 22's #30/#360/
#361 incident (`Implements TASK-N (#N)` instead of a bare `Closes #N`) — except this time
`develop/SKILL.md`'s own step-5 reminder (added earlier session 23) was already live and committed
*before* PRs #376/#377 were even opened (confirmed by timestamp: fix at 09:05 UTC, #376 at 09:43 UTC,
#377 at 10:00 UTC), and both PRs still got it wrong. Only PR #378, opened later the same session, got
it right. Closed #372/#373 manually. Ran `/retro`: writing the reminder in the Skill was evidently not
enough on its own, so `develop/SKILL.md` gained a new step 6 — after a PR merges, actually check the
referenced issue's state (`gh issue view <N> --jq .state`) and close it manually right away if still
open, instead of relying on a session-later `/orient` to catch it. Logged to `CHANGELOG.md`
(2026-08-08 (4)), landed via lis-platform PR #383.

## FEAT-020 (QC gating of result release) kicked off this session — proposal approved, ADR-0019
accepted, TASK-070 (#384) created; **not yet implemented**

Of M5's four unblocked open features (FEAT-020/022/023/025), FEAT-020 chosen: Critical priority, its
sole dependency (FEAT-019) closed last session, and the direct safety payoff KB-27/`domain/qc-westgard`
Skill entry #4 have named since FEAT-018's own kickoff.

**Two real, load-bearing findings from this proposal's own research**, both resolved in **ADR-0019**
(accepted): (1) this codebase has no separate "release" action to gate at all — the closest existing
concept is `ordered_test.status -> 'resulted'`, already gated by `FinalizationRollupInterceptor` for
unacknowledged criticals (Constitution Law #3), so the QC gate extends that same interceptor rather
than inventing a new one; (2) `observation.instrumentId`/`control_lot.instrumentId` are real schema
columns that **no application code anywhere ever sets** (confirmed by repo-wide grep) — KB-27's stated
"analyte × instrument" gate scope is currently unenforceable as written, so the hold is scoped by
analyte alone until something actually populates `instrumentId` (a documented, safety-favoring
over-block, not a silent gap). A third: `qc_rule_violation` (ADR-0018) has no resolve/acknowledge
lifecycle by design — ADR-0019 adds nullable `resolvedAt`/`resolvedByUserId` columns and a new
`resolve_qc`-capability-gated `POST /v1/qc-rule-violations/:id/resolve` action, mirroring
`critical_notification`'s own acknowledge-lifecycle precedent.

All four of the proposal's own §10 questions resolved via their recommended option, same session:
ADR-0019 accepted as drafted; issue #381 (no control-lot list/QC dashboard screen, filed last session)
folded into TASK-070's own frontend scope rather than left as a separate task, since this is the first
feature that makes resolving a violation a real, needed user action; **TASK-070 created as issue
#384**, single and undivided (the gate and resolve halves are small and tightly coupled); the
`resolve_qc` capability/role mapping deliberately left for the implementer to research against the
real Keycloak role model at implementation start, not guessed here. Landed via lis-platform PR #385
(proposal) and a direct `lis-engineering` main commit (ADR-0019 acceptance).

**No code written yet.** TASK-070 (#384) is ready for a future session's `/develop` invocation.

## `/close` this session found one new Engineering Flow Retrospective finding, fixed the same session

GraphQL quota was already at **0/5000 remaining** at this session's very first `gh` call needing it
(`gh issue list --json ...` for the M5 board snapshot, CHECKLIST.md item 9) — the third distinct
GraphQL-quota incident this project has now hit (session 22's own mid-session block; `import-to-
github.sh`'s own waste, fixed last session's PR #380). Worked around via the REST equivalent at the
time; recurred again later the same session (checking PR #385's own CI). Fixed proactively rather than
just noted again: `engineering-radar/SKILL.md` gained a new check (3b) — `gh api rate_limit --jq
'.resources.graphql'`, flagged alongside the existing SSH-IP infra-risk check — so a future session
knows to prefer REST from the start instead of discovering the exhaustion via a failed command.

**Manual Verification Checklist:** nothing closed this session has a human-checkable surface — #372/
#373 were bookkeeping closures of already-merged work, the `develop/SKILL.md`/`engineering-radar`
changes are documentation, and FEAT-020 itself is proposal-approved only, not implemented.

**Next session: `/develop` TASK-070 (#384)** — the QC release gate + resolve action, per the now-
approved proposal (`docs/plans/feat-020-qc-gating-of-result-release.md`) and accepted ADR-0019. The
one still-open design question (which capability/role `resolve_qc` maps to) needs real research
against the existing Keycloak role model before the migration is written, not a guess.
