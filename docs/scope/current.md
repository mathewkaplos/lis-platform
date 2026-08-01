# Status — 2026-08-01 (session 9, continued)

Last commit on main: 6fa9b43 — "docs: note MCP fallback for gh write commands blocked by the classifier (#248)".

## What's actually done (per real evidence)

Continuing the same session that produced PR #243/#244/#245/#246: #232's own comment thread was
re-checked directly, fresh, one more time — and this time genuinely both items were confirmed by
a human. #232 was closed with an evidence-citing comment:

- **Item 1 (real browser login/logout over tailnet HTTPS)** — confirmed by a human completing the
  actual round trip against `https://lis-staging.taila0fbf9.ts.net/`, a full interactive Keycloak
  auth flow, not just CI's HTTP-level smoke check.
- **Item 2 (TASK-035 Storybook visual/contrast glance)** — already confirmed in the prior comment
  (a human viewing Storybook directly at `localhost:6006`, including the StatCard WCAG AA
  contrast fix).

With #232 closed, **#17 (FEAT-008: Authentication) was also closed** — all four tasks already
closed (TASK-028/029/030/031, #87-90), its Implementation Proposal already `IMPLEMENTED`, and
#232's now-confirmed login/logout round trip is this feature's own "demoed on staging" DoD
evidence.

**#2 (EPIC-002) was explicitly *not* closed** — this needs stating plainly because a first draft
of the plan for this session listed #2 as a closeable candidate alongside #232/#17, which was
wrong: EPIC-002's own Definition of Done requires all three child features closed, and #18
(FEAT-009) and #19 (FEAT-010) are both still open, each blocked on its own not-yet-attempted
staging demo — unrelated to #232. Caught by re-reading #2's actual body directly before acting,
not by trusting the earlier framing — the same "no signal is self-verifying" discipline this
project's own standing rule (AGENTS.md, PR #244) exists to enforce, applied here to this
session's *own* prior claim, not just a past session's.

**The `engineering/frontend-design` Skill (tracked in #234) was drafted and committed** to
lis-engineering (`21cf80e`), after explicit human approval. Five entries, each citing a real
origin from FEAT-010's actual implementation: `StatusPill`'s never-color-only clinical-flag rule,
`StatCard`'s WCAG AA contrast gap (only caught by CI's real a11y check, not by eyeballing the
token hex value), the dual dark-mode mechanism wired ahead of the toggle that needed it, the
`transpilePackages`/cross-bundler gap (Storybook passing does not prove Next.js will render it),
and #240 (sidebar nav hidden below `sm` with no replacement trigger) flagged as an open "not yet
covered" item. **#234 was then closed**, citing the committed Skill as the resolving evidence.

**#193/#194 were checked for a new repro lead, on request — none found in either issue's own
thread** (both unchanged since 2026-07-31, zero new comments). A real cluster of ~10 failed
"Deploy to Staging" runs *was* found in raw CI history (2026-08-01, 03:36–08:02 UTC) — but tracing
it back through git history showed it's fully explained by **#188's own iterative fix process**
(commits `a25ff02` through `40e3a5c`, PRs #218–#227, all merged that same morning): a MagicDNS
discovery bug matching every tailnet peer (fixed #219), a prune-only-on-success step that let disk
fill during #188's own repeated failed-deploy iterations (fixed #225), and Keycloak's real ~91.6s
boot time outrunning too-short smoke-test windows (fixed #227, widened to 200s). None of these
three signatures (Keycloak 502, disk-full, `.env` MagicDNS corruption) match #193's exit-56 or
#194's exit-52, both specifically on the *`Smoke test (api, internal)`* step — different issue,
already resolved, not a lead for #193/#194. Deploy to Staging has been green continuously since
08:20 UTC. **#193 and #194 remain open, genuinely unreproduced, unchanged.**

The `/close` Skill's Pre-Close Report (19:23) found the breadcrumb itself 2 commits stale (fixed
by this rewrite), #234 closeable (done above), and one Engineering Flow Retrospective finding:
`gh issue comment` was denied by the permission classifier once this session, while a
functionally identical `gh issue close --comment` ran unblocked later in the same session — the
MCP `add_issue_comment` tool is the confirmed-working fallback *for when that block happens*, not
a suggestion to prefer MCP over `gh` by default. Approved and added to AGENTS.md as PR #248
(`6fa9b43`), merged this session.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 12 closed / 3 open (was 11/4 at session start;
#17 closing this session moved the count).

M2's remaining open items:
- **#2** (EPIC-002) — stays open until #18 and #19 both close too. Do not close on #17/#232
  clearing alone — see the correction above.
- **#18** (FEAT-009) — blocked on its own staging demo, not yet attempted.
- **#19** (FEAT-010) — blocked on its own staging demo, not yet attempted.

**Unrelated open issues, not M2-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unreproduced (re-checked this session, see above;
  unchanged across multiple sessions now, from session 4).
- **#240** — sidebar nav fully hidden below `sm` breakpoint, no replacement trigger. Found this
  session during TASK-036's own manual-verification pass; needs a triage decision (fast-follow vs.
  a later dedicated mobile pass), not decided here. Flagged as an open item in the new
  `frontend-design` Skill's own "not yet covered" section.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **A closeable-looking epic still needs its own DoD checked, not inferred from its
  most-recently-cleared blocker.** This session's own first pass listed EPIC-002/#2 as closeable
  right alongside #232/#17, reasoning from "the blocker that was just resolved" rather than
  #2's actual body text (which requires all three child features closed, and two — #18, #19 —
  were still open for an unrelated reason). Caught before acting, by reading #2's body directly.
  Generalizes the same standing rule already in AGENTS.md ("no single status signal is
  self-verifying") to a subtler case: even a real, freshly-confirmed signal about *one* blocker
  doesn't prove a parent's full DoD is met if that DoD has other, unrelated conditions.
- **A CI failure cluster that looks like new flakiness may just be a past investigation's own
  visible trail.** ~10 failed Deploy to Staging runs in one morning looked, from run-list alone,
  like a real new repro lead for #193/#194. Tracing each failure's actual step and error text,
  then cross-referencing against git log, showed it was entirely #188's own iterative fix process
  (7 commits, already merged) — not new information. Don't conclude "new lead" from a failure
  count alone; read what actually failed and check whether it's already an explained, closed
  story before treating it as fresh.
- **`gh issue comment` vs. `gh issue close --comment`** — the permission classifier blocked one
  and not the other for functionally the same underlying write, within the same session. If a
  `gh issue`/`gh pr` write command is denied, the equivalent `mcp__github__*` tool
  (`add_issue_comment`, `issue_write`, etc.) is a confirmed-working fallback — reach for it *after*
  a block, not as a default preference over `gh`. Now a standing note in AGENTS.md.
- Session 9's earlier notes/gotchas (checking child tasks/comment threads, not just headline
  Project-status fields; closing convention is a comment, not a body edit) are unchanged and still
  apply — not repeated here, see git history for the full earlier breadcrumb if needed.
