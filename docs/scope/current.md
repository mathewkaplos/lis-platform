# Status — 2026-08-10 (session 30)

Last commit on main: `c8dccb7` (`lis-platform`) / `a2a4db4` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M6/M7 wrap-up: FEAT-034 finalized, FEAT-029's deferred AC #2 built as SLA timers, both fully shipped

Session continued from session 29 (context compacted mid-task, resumed directly per the
`SessionStart:compact` hook, no fresh-session Rule #0 gate). Picked up exactly where session 29 left
off: FEAT-034 (Operational reports) was implemented but not yet PR'd/merged; finished it, then
picked up M7's status ("what's next on M7"), discovered FEAT-029's own mechanism was already
shipped with issue #38 deliberately left open for a deferred AC #2, and built that deferred half as
a new, distinct feature (SLA timers via the workflow engine) rather than attempting the three
synchronously-coupled migrations issue #38 originally named.

### FEAT-034 (Operational reports: TAT, workload, rejection rate) — fully shipped, issue #43 closed, merged PR #453

Three read-only aggregate reports (`GET /v1/reports/operational/{tat,workload,rejection-rate}`),
gated behind a new `view_operational_reports` capability (`qa` role only). TAT scoped to
`ordered_test` panels via `observation.status = 'verified'` (confirmed: `ordered_test.status` never
reaches a literal `'verified'` value anywhere in this codebase — verification is tracked exclusively
on `observation`).

- **Two real, distinct test-fixture-isolation bugs found and fixed** during e2e hardening, both now
  documented as `engineering/testing` Skill entry #13 (lis-engineering): a "safely wide" TAT time
  window silently summed in every other spec file's own real-time `routine`-priority fixtures once
  run as part of the full suite (fixed by excluding real "now" from the window entirely, not by
  widening the margin further); the workload window, even after a first DB-clock-anchored
  tightening, remained intermittently contaminated by `test-user-4`'s shared identity across other
  spec files (fixed by deriving the window from the fixture's own two real `observation` row
  timestamps directly, not any wall-clock estimate). Confirmed stable across 3 consecutive full-suite
  runs (324/324) after both fixes.
- Docs-only follow-up PR #454 marked the proposal `IMPLEMENTED` with the merge SHA.
- **Real process gap found and fixed via `/retro` mid-session**: PR #453 itself was opened without
  a bare `Closes #43` line, so #43 didn't auto-close and needed a manual close — the fifth
  recurring instance of a failure the `develop` skill's own step 5 already tracked (#93/#94,
  #360/#361, #372/#373, #376/#377). Step 5 rewritten from a prose reminder into a mechanical check
  (grep the drafted PR body for `^Closes #<N>$` before calling `gh pr create`) — see
  `lis-engineering` commit `b9d5718`. PR #455 (below), opened later the same session, correctly
  included the line and auto-closed cleanly.

### FEAT-029 (remainder) — SLA timers via the workflow engine — fully shipped, issue #38 closed (finally), merged PR #455, ADR-0033

Discovered mid-session that FEAT-029's own engine mechanism was already `IMPLEMENTED` (PR #438) and
its two consumers (FEAT-030 reflex, FEAT-031 auto-verification) were already closed — issue #38
stayed open *only* because its AC #2 ("migrate existing hard-coded workflows onto the engine") was
explicitly deferred by the original proposal. Investigated what AC #2's three named targets
(critical-notification creation, delta-check flagging, calculated-field cascading) would actually
require and found all three are **synchronously coupled to the very API response that produces the
data being evaluated** — moving any of them onto the engine's async, at-least-once dispatch model
(ADR-0028's own explicit design) would be a real behavior change on patient-safety-adjacent paths,
not a refactor. Declined all three; built the one piece of KB-25's workflow-engine spec that has
zero such coupling and was entirely unbuilt instead: SLA timers and escalation.

New proposal drafted, approved (3 open questions, all resolved as recommended), and implemented in
the same session — `docs/plans/feat-029-sla-timers-workflow-migration.md`:

- `SlaBreachDetectorService`: two-phase detection reusing `CriticalNotificationEscalationService`'s
  proven shape (`lis_scheduler` cross-tenant enumeration, per-tenant `lis_app` detection), emitting
  a same-transaction `SlaBreached` outbox event + audit write per real breach.
- `NotifySlaBreach`: the third real `WorkflowCommandRegistry` handler (after `AddReflexTest`,
  `AutoVerifyObservation`) — re-verifies the panel is still unverified before escalating (resolves
  instead, if it verified in the gap between detection and dispatch — an expected race, not a bug).
- `GET /v1/sla-breaches`, gated behind `view_operational_reports` (reused, not a new capability).
- **Real, load-bearing architectural finding, re-approved mid-implementation**: `ordered_test`'s
  existing `tenant_isolation` RLS policy needed widening to the non-throwing 2-arg form (mirroring
  `critical_notification`'s own already-shipped precedent) before `lis_scheduler` could read it at
  all — Postgres evaluates every applicable PERMISSIVE policy and ORs them, so a throwing policy on
  one aborts the whole query regardless of a second, narrower policy that would otherwise allow it.
  Confirmed directly via real `psql` sessions as both `lis_scheduler` (reads exactly
  `tenant_id`/`created_at`/`status`, nothing else — column-scoped GRANT) and via the widened policy
  not throwing for a session with no `app.tenant_id` set.
- **ADR-0033**: the condition-evaluator's `ALLOWED_FIELDS` allow-list stays one flat list shared
  across event types (folding in `priority`/`targetMinutes` for `SlaBreached`) rather than becoming
  event-type-aware — `on` remains the sole event-type filter, applied at evaluation time, not
  publish-time validation. Accepted tradeoff: a misdirected rule silently no-ops instead of failing
  at publish time — not a safety gap, since `when` was never the safety boundary for any registered
  handler regardless (each re-verifies live state).
- **A second, cross-feature instance of the FEAT-034 fixture-window-contamination class**: this
  feature's own SLA e2e fixtures (STAT/90min, routine/5min backdates) landed inside
  `operational-reports.e2e-spec.ts`'s own TAT window with the same priority, inflating its
  exact-count assertions — fixed by loosening those to a floor (`byTest`'s own assertions remain the
  structurally-immune exact-count proof). Folded into `testing` Skill entry #13 as its own
  documented sub-case.
- Confirmed stable across 3 consecutive full-suite runs (330/330) after both fixes.
- Docs-only follow-up PR #456 marked the proposal `IMPLEMENTED` with the merge SHA.

### `/retro` cycle — `develop` skill step 5 (Closes #N), logged in `CHANGELOG.md`, merged PR #457

Covered above under FEAT-034 — logged as its own changelog entry per the `/retro` Skill's own
process (`~/work/lis-platform/CHANGELOG.md`, entry `## 2026-08-10 (2)`).

### `testing` Skill entry #12 sharpened (lis-engineering, direct commit `a2a4db4`)

Approved via this session's Pre-Close Report pending items (`~/work/lis-engineering/
session-close-reports/2026-08-10-1050-pre.md`). Hit the exact `.env`-not-sourced failure three
times mid-session from a fresh agent Bash tool call that hadn't re-sourced `.env` itself, despite an
earlier call in the same session already having done so — the Bash tool doesn't persist shell state
(including sourced env vars) across separate calls, only the working directory. Entry #12's old
"once per shell session" phrasing undersold this; rewritten to say explicitly: source `.env` in
every separate tool call that needs these vars, chained with `&&` in that same call, not "already
done earlier this session."

### Manual verification performed live this session (Pre-Close Report items, both confirmed)

- **FEAT-034**: built and started a real compiled `apps/api` server (hit, and fixed, the known
  stale-`tsconfig.build.tsbuildinfo` gotcha along the way — `rm apps/api/tsconfig.build.tsbuildinfo`
  before rebuilding). Hit all three operational-report endpoints with a real Keycloak-issued `qa`
  token: all returned 200 with correctly-shaped (empty, since no fixtures existed post-reset) JSON.
  Confirmed 403 for a real `technologist` token against the same route.
- **FEAT-029**: published a real `SlaBreached` → `NotifySlaBreach` rule via the live API, created a
  real STAT order/specimen via the live API, backdated its `ordered_test.createdAt` 90 minutes via
  direct SQL (append-only-safe, same technique as every other e2e fixture in this codebase), then
  waited for the server's own real `@Interval(5 min)` ticks — not a test harness calling
  `detectOverdue()`/`tick()` directly — to actually detect and escalate it end-to-end. **Fully
  confirmed, via real wall-clock timing, not a test shortcut**: `SlaBreachDetectorService`'s own
  tick at 08:00:19 UTC created the `sla_breach` row (`pending`) plus its `SlaBreached` outbox event;
  `OutboxRelayService`'s own next tick at 08:05:19 UTC picked it up, dispatched through
  `WorkflowEngineService` to the real published rule, and `NotifySlaBreach` escalated it
  (`status: escalated`, `escalationLevel: 1`). One real false-positive along the way, corrected
  before trusting it: an early polling script's own `tail -1` check picked up `psql`'s
  `set_config()` return value instead of the actual query result, reporting "DETECTED" a full
  ~2 minutes before the real tick had even fired — caught by directly re-querying the table instead
  of trusting the loop exit, not by re-running the same flawed check again.

## Carried into next session

- **FEAT-027** remains the only real M6 work left, still blocked on the design partner naming their
  actual instrument (protocol: ASTM vs HL7, vendor/model) — unchanged from session 29, not
  re-investigated this session.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted.
- Issues #427, #430 remain open, both deferred/filed in session 29, untouched since.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- Carried from session 28/29, still not done by a human: a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges
  read clearly at a glance.
- **M7 (EPIC-006, Configure & Report) is now code-complete** — all four features (FEAT-032/033/
  034/035) merged and closed. The epic issue itself (#6) stays open by its own stated Definition of
  Done ("closed only after its terminating milestone's exit criteria are met... demonstrably true in
  the deployed staging environment") — a staging demo to the design-partner lab, not more code, is
  what would close it. Not something this session attempted or could attempt autonomously.
- **Next session:** M6 has no more independently-startable work beyond FEAT-027 (blocked). M7 has
  no more buildable work at all (epic closure is a staging-demo/human decision, not code). Check
  whether a milestone after M7 (per the Execution Plan) has any issue that doesn't depend on FEAT-027
  either — not assumed from this file alone, worth a fresh `/orient` milestone check.
