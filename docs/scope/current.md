# Status — 2026-08-02 (session 11)

Last commit on main: 4fabe93 — "docs: record #256's actual outcome in its Implementation Proposal (#258)".

## What's actually done (per real evidence)

Session 10 closed out M2's engineering work but left one known gap: `unmanagedAttributePolicy:
"ENABLED"` (required for the custom `tenant_id` Keycloak attribute to survive any live write) was
only a manual, live-only setting on staging's realm — not committed anywhere — and would be
silently wiped by `deploy-staging.yml`'s own Keycloak force-recreate (added that same session).
This session (`/orient` → engineering-radar → filed and closed **#256**) fixed that gap for real.

**#256 closed, via PR #257 + PR #258.** The original plan (Implementation Proposal
`docs/plans/task-256-commit-unmanaged-attribute-policy.md`) was to commit a `components`/User
Profile block directly into `infra/keycloak/lis-realm.json`. That turned out non-executable:
confirmed via `scripts/feat009-staging-verify.md` that there is no SSH/droplet-console access
available this session, and hand-authoring Keycloak's exact `components` wrapper schema from
documentation alone was judged too risky (a wrong guess would silently no-op, not error).
**Revised mechanism (human-approved):** automate the already-proven GET/merge/PUT Admin REST API
sequence (the same one `scripts/feat009-staging-verify.md` Step 1 already used successfully) as an
idempotent step in `deploy-staging.yml`, run against Keycloak's own host-local `:8080` listener
right after it starts, before `api`/`web` come up. `infra/keycloak/lis-realm.json` itself is
unchanged by this fix.

CodeRabbit's review on PR #257 caught three real gaps in the first draft, all fixed before merge:
missing `--connect-timeout`/`--max-time` on the three new Admin REST calls, no fail-fast/empty-
token check (a broken admin login would have silently no-op'd instead of aborting the deploy), and
`api`/`web` starting concurrently with the policy fix instead of after it. All three fixed,
re-verified locally, then verified for real: PR #257's merge auto-triggered a staging deploy (run
`30742799694`) whose own log shows the profile re-fetched with `unmanagedAttributePolicy: ENABLED`
and `PUT: HTTP 200` — proving the setting was reapplied automatically right after that deploy's
real Keycloak recreate. #256 auto-closed via the PR's `Closes #256` line.

**Accepted verification gap:** an actual live user write with `tenant_id` surviving specifically
on *staging* (vs. the identical mechanism already proven locally, including a full live user-write
round trip) was not independently re-checked — needs droplet-console access not available this
session. Human explicitly accepted the deploy-log evidence as sufficient (2026-08-02) rather than
leaving this silently unverified.

**Docker daemon crashed mid-session** (memory pressure: 215Mi free of 7.6Gi at the time) while
verifying the fix locally. No self-recovery path existed for the agent (no passwordless sudo, no
TTY for an interactive sudo password) — required the human to restart Docker Desktop on the
Windows host. Recovered cleanly once restarted; no data lost. Written up as an Engineering Flow
Retrospective finding this session (see below).

**Two AGENTS.md additions this session** (both approved 2026-08-02, see `AGENTS.md`'s Rules of
engagement for the full text):
1. If a `docker`/`docker compose` command hangs rather than errors, check `systemctl is-active
   docker`/`pgrep dockerd` before assuming a compose-file or command bug — and if the daemon is
   down, say so plainly rather than retrying the same command.
2. Before drafting an Implementation Proposal's mechanism for anything touching staging/production
   infra, check the relevant runbook(s) for already-documented access constraints (SSH
   availability, reachable ports, credential locations) first — the #256 IP's original mechanism
   assumed SSH access already documented elsewhere as unavailable, costing a full revision cycle
   that checking first would have avoided.

**Session-close Final Close Report** written and pushed to `lis-engineering`
(`session-close-reports/2026-08-02-1328-final.md`), resolving `2026-08-02-1119-pre.md` (which had
carried no pending items forward). This report's own fresh checks surfaced the three items above
(breadcrumb refresh, the two retrospective notes) — all resolved by explicit human decision before
this breadcrumb was written.

## M2 exit criteria — status

Unchanged from session 10 — M2's own exit criteria (`/mnt/d/LIS/research/LIS-Execution-Plan.md:97-99`)
remain fully satisfied; see git history for the full evidence table. This session's work was a
carried-forward infra gap fix (#256), not new M2 scope.

## EPIC-002 (#2) — current state: open, pending a design-partner demo

Unchanged from session 10. #2 stays open until a real design-partner demo happens — explicit human
decision (2026-08-02, session 10), reconfirmed still accurate this session (no new information
changes this). **Do not close #2 on any future session's own initiative** — every engineering box
is checked; the design-partner demo is the one remaining, non-engineering blocker.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 14 closed / 1 open (unchanged this session —
#256 was not M2-milestoned). The one remaining open M2 item is #2 (EPIC-002) itself, not blocked on
any further engineering work.

**Unrelated open issues, not M2-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unreproduced (last checked 2026-08-01; unchanged
  across multiple sessions now, from session 4).
- **#240** — sidebar nav fully hidden below `sm` breakpoint, no replacement trigger. Still needs a
  triage decision (fast-follow vs. a later dedicated mobile pass), not decided yet.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.
- ADR-0012's own acceptance criterion that port 22 remains SSH-restricted to `tag:ci-runner` —
  session 10 left this unconfirmed; **resolved this session's `1119-pre.md` report**: a real
  `ssh root@100.98.252.45` attempt from a human device timed out, confirming the ACL widening
  didn't loosen SSH access. No longer an open item.
- **`unmanagedAttributePolicy` live-only-setting risk — closed this session.** See #256 above. No
  longer an open item.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- **#74 (TASK-015)'s out-of-band closure — resolved, no longer open.** Corrected this session
  (orientation drift check): #74 is CLOSED, with real verification already in its own comment
  thread — `.github/workflows/constitution-gate.yml` confirmed live on `main`, enforcing Law #1
  and Law #4 in CI, with five consecutive green runs cited as evidence. The prior breadcrumb wording
  ("remains unverified") was stale; dropped from the carried-forward list.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **A realm-file change can deploy successfully and still never take effect** (session 10's
  Keycloak-no-persisted-volume finding) — unchanged, still true, still worth knowing. Full detail
  in `authentication` Skill entries #7-#10.
- **A live-only Keycloak setting doesn't survive a force-recreate unless something reapplies it
  every deploy.** This session's own #256 finding, generalized: any manual admin-console/Admin-API
  tweak made directly against staging (not committed anywhere) is exactly as fragile as
  `unmanagedAttributePolicy` was — check for other undocumented live-only settings if staging
  behavior ever silently regresses after a deploy.
- **Local Docker verification has no agent-side recovery if the daemon dies.** New this session —
  see AGENTS.md's Rules of engagement. If `docker`/`docker compose` hangs, check whether the daemon
  itself is actually running before assuming a code bug.
- **Check known access constraints (SSH, ports, credentials) before drafting an IP's mechanism for
  staging/production infra work.** New this session — see AGENTS.md's Rules of engagement. Costly
  to skip: the #256 IP's first draft assumed access that was already documented as unavailable.
- Earlier sessions' notes/gotchas (checking child tasks/comment threads not just headline
  Project-status fields; `gh issue`/`gh pr` write denials falling back to `mcp__github__*`;
  closing convention is a comment, not a body edit; PreToolUse denials needing a read-only
  verification before assuming partial execution) are unchanged and still apply — not repeated
  here, see git history for earlier breadcrumbs if needed.
