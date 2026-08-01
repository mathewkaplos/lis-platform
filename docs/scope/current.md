# Status — 2026-08-01 (session 8)

Last commit on main: a1fabc3e9f8ddaaec9b04b22dcea899e79344b30 — "docs: FEAT-010 proposal ->
IMPLEMENTED, #19 comment, harness principle (#239)". (This line was dropped in this same
session's earlier full rewrite — the close Skill's check #6 greps for it specifically to verify
breadcrumb freshness; restored here so that check works mechanically again, not just by eyeballing
the prose below.)

## What's actually done (per real evidence)

Session 8 opened by finding session 7's breadcrumb had overclaimed progress: TASK-036 (#95, app
shell) was reported as "completed and closed" but issue #95 was still open, untouched since
creation, with no implementing commit or PR anywhere. Corrected the breadcrumb (PR #235), then
wrote and got approval for TASK-036's own Implementation Proposal revision (PR #236, resolving
the one real open question — see below), then actually implemented and merged it (PR #237,
closing #95 for real this time — verified via `gh issue view 95` showing `state: CLOSED` after
merge, not just assumed from the PR body).

- **TASK-036 (app shell) — implemented and merged as PR #237, #95 genuinely closed.** New
  `(app)` route group in `apps/web` wraps every authenticated route in a sidebar + top bar,
  composed from TASK-035's primitives. Theme toggle persists via an httpOnly cookie (SSR reads
  it before first paint, no flash of wrong theme). Command palette is a real stub (Cmd/Ctrl+K,
  "Coming soon", no command registry) per FEAT-010's own AC wording. Tenant label renders
  `session.tenantId` as a static, non-interactive element rather than a switcher — resolved
  during proposal drafting: no organizations/branches data model exists anywhere in this repo
  (confirmed directly — no table, no domain type, session carries only `tenantId`), so the task
  doesn't fabricate UI ahead of that schema. Revisit once org/branch is actually modeled (not
  yet scoped as any tracked work).
- **Two real, previously-latent bugs found and fixed while building TASK-036** — both flagged as
  candidate first-content for the still-missing `engineering/frontend-design` Skill (#234,
  commented with the details):
  1. `globals.css`'s dark-mode media query applied unconditionally, so picking "light" while the
     OS was set to dark had no effect — needed a `:not([data-theme="light"])` guard so the
     manual toggle actually overrides the system preference in both directions.
  2. `@lis/ui` was being consumed via its `tsc`-compiled CommonJS `dist`, which prepends
     `"use strict"` before each client component's own `"use client"` directive — breaking
     Next.js's client-boundary detection (`Element type is invalid: ... got undefined`) the
     first time a real Next.js page actually rendered a TASK-035 primitive. TASK-035 itself was
     only ever exercised via Storybook/Vite, which reads source directly and never hit this
     path — so this bug shipped invisibly in PR #216 and PR #217 both. Fixed by pointing
     `@lis/ui`'s `main`/`types` at `src/index.ts` directly and adding
     `transpilePackages: ["@lis/ui"]` to `apps/web/next.config.ts` — matching shadcn/ui's own
     documented monorepo pattern (already researched in TASK-035's own proposal §3, just not
     fully wired up).
- **Real end-to-end verification, not just typecheck/build.** This sandbox has the same
  missing-`libnss3.so`/no-root limitation noted in TASK-034/035/037's own risk sections — worked
  around this time by `apt-get download` (no root needed) + extracting the `.deb`s directly and
  pointing `LD_LIBRARY_PATH` at them, then driving a real headless Chromium against `pnpm dev`
  with a session cookie minted locally using the same signing code/secret `apps/web` itself uses
  (no live Keycloak needed for this UI-only check). Confirmed: shell renders server-side, theme
  toggle flips `[data-theme]` and survives a hard reload, command palette opens via keyboard and
  closes via Escape, zero console errors, both light/dark screenshots look correct.
- **New follow-up issue filed: #234** — `engineering/frontend-design` Skill, required by
  FEAT-010/035/047/048's own issue text, doesn't exist anywhere in `lis-engineering`. Not
  blocking (per human decision at session start) — now has two real candidate findings attached
  (the bugs above) for whoever authors it.
- **FEAT-010's four tasks (TASK-034/035/036/037) are now genuinely all done, merged, and their
  own issues closed** — corrected from session 7's premature claim. FEAT-010's own feature-level
  issue (#19) is deliberately left open, not auto-closed: its own Definition of Done includes
  "demoed on staging" and "Implementation Proposal archived with status IMPLEMENTED".
- **`feat-010-design-system-v1.md`'s Implementation Proposal archived for real, PR #239.** All
  four `Status:` headers (original TASK-034 proposal + the TASK-035/037/036 revisions) moved from
  `APPROVED` to `IMPLEMENTED`, each citing its actual merge SHA (#212/#216/#217/#237) — the DoD
  item this specifically requires. Commented on #19 explaining it stays open pending only the
  staging demo now (same pattern as #17/FEAT-008) — the proposal-archival half of its DoD is done,
  the staging-demo half genuinely isn't yet.
- **AGENTS.md's Rules of engagement gained a new standing principle, PR #239**: "a pass in one
  test/build harness does not prove a pass in another" — cites three real instances this project
  has actually hit (Reflector DI/#185, `set_config` connection-pooling/#177, and this session's
  own `transpilePackages` bug/#237), not a hypothetical.
- **Session-close retrospective surfaced two real findings**, both resolved by human decision, not
  silently: (1) a project Skill for interactively verifying `apps/web` (dev-server launch,
  session-cookie minting without live Keycloak, this sandbox's `libnss3.so` workaround) was
  approved and drafted at `.claude/skills/web-verify/SKILL.md` — **not yet committed**, shown to
  the human for review first, per Level-2 drafting discipline; (2) `gh pr merge` was blocked
  inconsistently by the platform's own auto-mode classifier on 2 of this session's 5 merges — human
  decision: leave as-is, it's an independent safety layer, not a bug to route around; revisit only
  with clearer evidence across many future sessions, not this one session's five data points.
- **New backlog item filed, not milestone-scoped yet: #240** — TASK-036's `Sidebar` is fully
  hidden below Tailwind's `sm` breakpoint with no replacement trigger (hamburger/drawer) to reach
  it on narrow viewports. Found during TASK-036's own manual-verification pass, not by any
  automated check. Fast-follow vs. accept-for-now deliberately left as an open decision, not
  resolved here.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 11 closed / 4 open (confirmed via
`gh api repos/:owner/:repo/milestones/3` after TASK-036's merge — up from the 9/6 session 8
opened with, once #95's overclaim was corrected). M1 unchanged at 3 open/16 closed, all three
still individually blocked (see earlier session detail via git history if needed).

M2's remaining open items:
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unresolved, unchanged across multiple sessions now
  (unreproduced exit-56/exit-52 deploy smoke-test failures from session 4).
- **#234 (new this session)** — missing `engineering/frontend-design` Skill. Not blocking.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **A breadcrumb's own claims are not self-verifying — check them against GitHub/git reality
  before trusting them, the same way any other claim gets checked.** This session opened by
  finding session 7's breadcrumb had wrongly marked TASK-036 done; the giveaway was cross-
  referencing the breadcrumb against `gh issue list`/`git log`, not trusting the prose. Worth
  doing this same cross-check reflexively at the start of every session, not just when something
  looks off.
- **A workspace package consumed only through a bundler-agnostic tool (Storybook/Vite here) can
  hide a real client-boundary bug that only surfaces the first time an actual Next.js page
  renders it.** TASK-035/037 both shipped and merged clean because neither ever exercised
  `@lis/ui` through Next's own bundler — worth remembering for any future workspace package that
  gets consumed by more than one build tool: passing in one doesn't prove it works in the other.
- **This sandbox's missing-`libnss3.so` limitation (blocking real Playwright screenshots,
  documented since TASK-034/035) has a real workaround**: `apt-get download <pkg>` doesn't need
  root, and the resulting `.deb` can be extracted with `dpkg-deb -x` and pointed at via
  `LD_LIBRARY_PATH` without ever needing `sudo apt-get install`. Needed `libnss3`, `libnspr4`,
  `libasound2t64` this session to get a real headless Chromium launching. Worth using this
  instead of falling back to "can't verify visually" next time this limitation is hit.
- Session 7's own notes/gotchas (droplet-log verification discipline, tailnet ACL port scoping,
  Keycloak config-value version drift, `if: always()` cleanup steps) are unchanged and still
  apply — not repeated here, see git history for the full session-7 breadcrumb if needed.
