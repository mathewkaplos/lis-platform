# Status — 2026-07-31 (session 6)

## What's actually done (per real evidence)

Session 5 closed #189/#197/#198 and left PR #191 (FEAT-010 Implementation
Proposal, TASK-034 scope) in draft, blocked on its own §10 (three open
questions, one of them — Q1 — genuinely blocking on issue #192's Stitch
MCP/GCP billing decision). This session resolved all three §10 questions,
approved the proposal, implemented TASK-034, and merged it.

- **PR #191 §10 resolved and Status moved DRAFT → APPROVED.** Q1: option
  (c) — skip live Stitch MCP generation for TASK-034 entirely; tokens
  written directly from §0's already-specified values, no metered API call
  made, live reference-screen generation deferred as a follow-up pending
  #192 (which itself remains unresolved — see below, this only unblocked
  TASK-034's own bootstrapping). Q2: proceed without authoring
  `engineering/frontend-design` now — real findings become that Skill's
  first content if/when TASK-035 surfaces them. Q3: confirmed — this
  proposal's scope stays TASK-034 only; TASK-035/036/037 get a later
  revision.
- **TASK-034 implemented and merged as PR #212 (`cf65386`).**
  `docs/design.md` (new) + `packages/ui/src/tokens.ts` (new, typed,
  exported from `packages/ui/src/index.ts`) transcribe the Stitch Prompt
  Library §0's full light/dark/accent/semantic/typography/spacing/
  radius/elevation token set. `apps/web/app/globals.css` rewired off the
  `create-next-app` scaffold onto the real tokens via Tailwind v4's
  `@theme` block, with dark tokens applying via both
  `prefers-color-scheme` (today's mechanism) and a forward-compatible
  `[data-theme="dark"]` attribute selector for TASK-036's future manual
  toggle.
  - Verified: `pnpm --filter @lis/ui typecheck`/`build`, repo-root
    `pnpm typecheck`/`pnpm lint`, `apps/web` dev server starts clean, and
    the compiled CSS chunk (recompiled fresh after the edit, confirmed by
    timestamp) contains the real new hex values.
  - **Not verified: a full logged-in-page screenshot.** No `chromium-cli`,
    no local Playwright in this environment; installing Playwright's
    Chromium binary failed twice (no sudo for `--with-deps` OS packages,
    and the plain binary download itself timed out/reset repeatedly on
    this network). Flagged explicitly in the PR rather than claiming a
    screenshot that doesn't exist. **Real gap, not just this session's
    problem** — TASK-035 (primitives) and TASK-036 (app shell) are
    genuinely visual work; get working browser tooling (or install
    Playwright's deps with sudo once, ahead of time) before starting
    either, or the same gap recurs and compounds.
  - CI green on the PR (`build-and-test`, `check-invariants`/Constitution
    Gate both passed) before merge; merged via `gh pr merge --squash`,
    branch deleted as its own separate step per the deploy Skill's
    merge/delete rule.
- **`docker-pnpm-monorepo-deploy` Skill updated (lis-engineering `56d2afa`,
  committed and pushed).** Added entries 10–14 documenting five real
  deploy-pipeline bugs from session 5 that hadn't been written down yet
  despite AGENTS.md's same-day rule: SSH-heredoc stdin swallowing, psql
  colon-interpolation failure, containerd image-store confusion, OOM/
  `mem_limit` tuning, and the stale `lis_default` network remediation. Full
  text now lives in the Skill itself — not repeated here.
- **Real gotcha found this session, not yet written anywhere durable:**
  PR #212's body used `Closes TASK-034 (#93).` — GitHub's auto-close
  keyword parser did **not** fire on merge (confirmed: issue #93 is still
  `OPEN` post-merge, milestone API still shows M2 at 6 closed/9 open,
  unchanged). The parenthetical form `Closes X (#93)` apparently breaks
  the keyword linkage that a bare `Closes #93` would trigger. **#93 needs
  to be closed manually** — not done autonomously this session, flagged
  for the next session's decision (or do it now: `gh issue close 93`).
  Worth a line in whichever Skill covers PR conventions if this recurs.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: milestone API still
shows 6 closed / 9 open (see #93 auto-close gap above — TASK-034's work is
genuinely done and merged, the count just hasn't caught up because the
issue itself is still open). M1 unchanged at 3 open/16 closed, all three
still individually blocked (see session 4 detail via git history if
needed — not repeated here).

M2's open items, current state:
- **#188** — Staging TLS + `KC_HOSTNAME` hardening. Still blocks "demoed on
  staging" DoD for #17/#18. Not touched this session.
- **#93 (TASK-034)** — implementation done, PR #212 merged, **issue itself
  still open** — see gotcha above. Close manually.
- **#94, #95, #96 (TASK-035/036/037)** — design-system build-out, next in
  sequence after TASK-034. Not started. TASK-035/036 are genuinely visual —
  see the screenshot-tooling gap above before starting either.
- **#192** — GCP billing/Stitch MCP decision. Still open, still not
  resolved — PR #191's Q1 only unblocked TASK-034's own bootstrapping via
  option (c), it explicitly does not resolve #192 itself (stated in the
  proposal). Do not conflate the two.
- **#193, #194** — still open, still genuinely unresolved, unchanged from
  session 5 (unreproduced exit-56/exit-52 deploy smoke-test failures). Do
  not assume closed or explained by anything in this session either.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #138 (audit all GH Actions secrets for placeholder values) — still open;
  session 5 found two real missing secrets ad hoc (`KEYCLOAK_ADMIN_PASSWORD`,
  `LIS_APP_DB_PASSWORD`) but never did the systematic audit this issue
  actually asks for.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still
  open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden
  dataset) — still open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **This environment has no working headless-browser tooling right now** —
  no `chromium-cli`, no local Playwright, and `npx playwright install`
  fails both on OS-level deps (no sudo) and on the plain Chromium binary
  download (unreliable network, repeated timeout/ECONNRESET on a ~160MB
  fetch). Any task that needs a real rendered screenshot (TASK-035/036
  especially) should either get this fixed first or explicitly plan to
  verify a different way (compiled-CSS-asset inspection, as done this
  session, is a partial substitute — not a real substitute for visual
  primitives/layout work).
- **`Closes X (#93)` in a PR body does not reliably trigger GitHub's
  auto-close keyword parsing** — use the bare `Closes #93` form (or verify
  after merge) if an issue needs to auto-close. See the #93 gotcha above.
- **Session 5's five deploy-pipeline gotchas (SSH-heredoc stdin, psql
  interpolation, containerd storage, OOM/mem_limit, stale network) are now
  documented in the `docker-pnpm-monorepo-deploy` Skill itself (entries
  10–14)** — read there directly rather than duplicating here.
- **`apps/web` has no public/unauthenticated page at this milestone** —
  `proxy.ts`'s matcher gates everything except `/api/auth/*`; `curl`ing the
  homepage locally redirects to `/api/auth/login`, which needs a running
  Keycloak to actually resolve. Confirmed again this session while trying
  to verify TASK-034's tokens visually.
- **`.mcp.json` (lis-platform, repo root) is untracked and not gitignored**
  — present again this session, not evaluated for secret content, not
  resolved. Flagged in the session-close report
  (`~/work/lis-engineering/session-close-reports/2026-07-31-2214.md`);
  still needs a decision (gitignore vs. commit) next session.
