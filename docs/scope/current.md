# Status — 2026-08-02 (session 11)

Last commit on main: 719e1c2 — "feat: migration: patient + identifiers + alerts (TASK-038) (#261)".

## M3 has started: TASK-038 (FEAT-011) merged this session

M2 was engineering-complete (only #2 open, blocked on a non-engineering design-partner demo) and
M1's 3 remaining open issues were all blocked on non-engineering factors — `/orient` →
engineering-radar reasoned this made **TASK-038 (#97, FEAT-011's first task)** the highest-leverage
next engineering work, unlocking the rest of M3.

**TASK-038 closed, via PR #261 (`719e1c2`).** Implementation Proposal
`docs/plans/feat-011-patient-management.md` approved (KB-02-minimal core scope: identity,
demographics required for range resolution, MRN + national ID — contact/insurance/emergency-contact
fields deliberately deferred until TASK-040 confirms the design partner's real requirements).
Delivered: `patient` + `patient_alert` tables (both RLS-isolated, live-leak-check verified), and the
ADR-0005 FK backfill onto `observation.patient_id`/`order.patient_id`.

**Real gap found during this proposal's own research, not fixed here:** ADR-0005 also required
`observation.ordered_test_id`/`specimen_id` to be FK-backfilled by TASK-023 — cross-checking that
ADR's literal acceptance-criteria text against the real schema (`packages/db/src/schema/
observation.ts`'s own still-present "FK backfilled by TASK-023" comments) showed it never actually
happened. **Filed separately as #260**, deliberately kept out of PR #261's scope (human decision,
2026-08-02) to keep that migration's diff and rollback story scoped to what TASK-038's own issue
describes.

**CI caught a real regression PR #261's own local testing plan missed**: `apps/api`'s e2e suite
(`capability-check.e2e-spec.ts`, run by CI's `build-and-test` job, never run locally as part of this
task's own plan) failed — a FEAT-009 proof controller used `randomUUID()` for `order.patientId`,
valid before TASK-038's FK backfill, silently wrong after. Fixed (real `patient` fixture row via a
new `insertDemoPatient` helper), verified locally (all 17 e2e tests green), pushed, CI green. Written
up as a fourth real instance of AGENTS.md's existing "a pass in one harness doesn't prove a pass in
another" rule, and as a new `database-design` Skill entry (#4) — grep every `.insert(<table>)` call
site on a table gaining a new FK, not just the migration's own tests, before considering an
FK-backfill done.

**Merge required the human**: `gh pr merge` is blocked for this agent by both a PreToolUse hook
(citing a prior incident where `--delete-branch` silently no-op'd a merge and deleted a branch with
unpushed work) and the auto-mode classifier itself. Merged by the human; branch cleanup (local +
remote delete) done by the agent afterward.

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

**M3 — Pre-Analytical Workflow: started this session.** TASK-038 (#97, FEAT-011's first task)
closed via PR #261. FEAT-011's remaining tasks — TASK-039 (#98, API), TASK-040 (#99, registration
form + duplicate detection), TASK-041 (#100, search + profile screens) — are still open; each will
need its own revision to `docs/plans/feat-011-patient-management.md` once the prior task's real
output exists (same scope-narrowing precedent FEAT-010's proposal used). `engineering/api-design`
and `domain/patient-identity` Skills, named as "Required Skills" by FEAT-011's own issue (#20), still
don't exist — flagged in the proposal, will be load-bearing for TASK-039's own revision.

**Unrelated open issues, not M2/M3-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unreproduced (last checked 2026-08-01; unchanged
  across multiple sessions now, from session 4).
- **#240** — sidebar nav fully hidden below `sm` breakpoint, no replacement trigger. Still needs a
  triage decision (fast-follow vs. a later dedicated mobile pass), not decided yet.
- **#260 (new this session)** — `observation.ordered_test_id`/`specimen_id` were never actually
  FK-backfilled by TASK-023, despite ADR-0005 requiring it. Found during TASK-038's proposal
  research, deliberately kept out of PR #261, filed as its own follow-up. Not yet worked.
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
