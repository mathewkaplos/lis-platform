# Status — 2026-08-01 (session 9)

Last commit on main: 3a8c4a7 — "docs: add web-verify Skill for apps/web interactive verification (#242)".

## What's actually done (per real evidence)

Session 9 opened by cross-checking session 8's breadcrumb against GitHub reality (per this
project's own recurring lesson: a breadcrumb's claims are not self-verifying). Found two real
errors, both corrected this session:

1. **The breadcrumb was one commit stale** — it cited `a1fabc3` as HEAD when `3a8c4a7` (PR #242,
   web-verify Skill) had already merged, and it still said the web-verify Skill was "not yet
   committed" when it now is.
2. **The breadcrumb's list of "M2's remaining open items" (#192/#193/#194/#234) was wrong.**
   None of those issues carry the M2 milestone at all (`gh issue view <n> --json milestone`
   confirms `milestone: none` for each). The actual open M2 issues are #2 (EPIC-002), #17
   (FEAT-008), #18 (FEAT-009), #19 (FEAT-010).

Digging into those four surfaced a bigger, more consequential error: **FEAT-008 (Authentication)
was not "not started."** Its issue (#17) still showed a stale `Status: Not Started` Project field
and an unedited body, but all four of its tasks — TASK-028/029/030/031 (#87-90) — were closed
long before this session, with real code already in the repo (`apps/api/src/auth/`,
`infra/keycloak/lis-realm.json` with `technologist`/`verifier` realm roles, `apps/web/auth/` +
`apps/web/app/api/auth/{login,callback,logout}`). #17 already had a correct closing comment from
an earlier session explaining it stayed open because staging's TLS/hostname setup blocked a real
browser login/logout round-trip — and that blocker (#188) was itself closed today, 2026-08-01,
via PR #218 (`a25ff02`), which is exactly why #232 (real browser verification over tailnet HTTPS)
now exists as the live follow-up. The lesson generalizes: **a feature issue's own summary
text/Project-status field can be stale even when its child tasks are closed and the comment
thread already has the real story — check the children and the comments, not just the parent
issue's headline fields.**

- **All three of EPIC-002's features (FEAT-008 #17, FEAT-009 #18, FEAT-010 #19) are now
  confirmed code-complete.** Bookkeeping brought in line with reality this session:
  - FEAT-008's Implementation Proposal (`docs/plans/feat-008-authentication-keycloak-oidc.md`)
    moved from `APPROVED` to `IMPLEMENTED`, citing all four merge SHAs (PR #175/#176/#177/#182).
    Followed up on #17 noting the TLS blocker its own closing comment named is now resolved, and
    that #232 is the one remaining item before it can close.
  - FEAT-009's issue (#18) had zero comments and stale Project-status despite both its tasks
    (#91/#92) being closed and its own proposal already `IMPLEMENTED` since 2026-07-31 — this
    was pure neglect, not a real gap. Added the same evidence-citing closing comment #17/#19
    already had.
  - EPIC-002 (#2) had zero comments despite all three child features being code-complete.
    Added a summary comment; left the epic open (correctly — none of its three children have
    closed yet).
  - None of these issues were closed — each is correctly blocked on its own "demoed on staging"
    DoD item, not on remaining engineering work. Convention followed throughout: task-level AC
    checkboxes and Project-status fields in issue bodies are left unedited (matching the
    #91/#92/#93-96 precedent) — evidence goes in a comment, not a body edit.
- **#232 — "Manual verification pending: real browser login/logout over tailnet HTTPS; TASK-035
  Storybook visual/contrast glance" — still open.** Its own "Done when" criteria require
  confirmation "by a human with tailnet access" for both items; this is explicitly not something
  an agent can close out. [Next: gather evidence via the web-verify Skill to make the human's
  review as fast as possible, without claiming either item done.]

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 11 closed / 4 open (unchanged count from
session 8's own confirmation — the count was right, the *named* open items were wrong; see
above). All four open issues (#2/#17/#18/#19) are individually blocked only on their own
staging-facing verification — no remaining engineering work in any of them.

M2's remaining open items (corrected):
- **#2** (EPIC-002) — stays open until its three children close.
- **#17** (FEAT-008) — blocked on #232 item 1 (real browser login/logout over tailnet HTTPS).
- **#18** (FEAT-009) — blocked on its own staging demo (not yet attempted).
- **#19** (FEAT-010) — blocked on its own staging demo (not yet attempted).
- **#232** — the two manual-verification items above; needs a human with tailnet access.

**Unrelated open issues, not M2-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unresolved, unchanged across multiple sessions now
  (unreproduced exit-56/exit-52 deploy smoke-test failures from session 4).
- **#234** — missing `engineering/frontend-design` Skill. Not blocking.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **Checking a feature issue's headline Project-status field and body text is not enough —
  check its child tasks and its comment thread too.** This session found FEAT-008 (#17) marked
  "Not Started" in its own Project field while all four of its tasks were closed, real code
  existed, and its comment thread already had the accurate story. The parent issue's own
  summary fields can lag the truth even when the truth is one click away in the same issue.
  Combined with session 8's own finding (breadcrumb prose can overclaim), the fuller rule is:
  **no single signal — breadcrumb, issue body, Project field, or comment thread — is
  self-verifying; check the actual child tasks/code/PRs when a feature's status matters.**
- **This project's convention for closing out task-level work is a comment, not a body edit.**
  AC checkboxes and Project-status fields inside issue bodies are deliberately left unedited;
  the evidence (PRs, merge SHAs, what was actually verified and how) goes in a closing comment
  instead. Followed for #17/#18/#2 this session; matches the #91/#92/#93-96 precedent.
- Session 8's notes/gotchas (breadcrumb self-verification, `@lis/ui` CJS/client-boundary bug,
  the `libnss3.so` `apt-get download` workaround) are unchanged and still apply — not repeated
  here, see git history for the full session-8 breadcrumb if needed.
