# Changelog

Continuous-improvement log for the agentic dev process itself, produced by
the `/retro` Skill (`~/work/lis-engineering/skills/workflow/retro/SKILL.md`).
One entry per `/retro` invocation — whether or not it actually changed a
file. Not a product changelog; see git history / PR descriptions for that.

## 2026-08-07

- **Friction:** `Skill(skill-creator)` returned `Unknown skill:
  skill-creator` this session even though it was the named skill to use for
  a task; the plugin exists on disk
  (`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator`)
  but wasn't loaded. Root-caused (not guessed) to
  `~/.claude/settings.json`'s `enabledPlugins`, which lists other plugins
  but not this one. Same-turn workaround: read the plugin's `SKILL.md`
  directly and followed it manually.
- **Area:** other-process
- **Change:** added a standing note to `AGENTS.md`'s "Rules of engagement"
  documenting the gotcha, the same-turn workaround, and that the real fix
  (enabling the plugin) is a global settings change owned by the
  `update-config` skill, not something to hand-edit here.
- **Files:** `AGENTS.md`

## 2026-08-07 (2)

- **Friction:** PR reviews keep missing whether `apps/api/openapi.json`/
  `packages/sdk/src/schema.ts` need regenerating when a route's
  request/response shape changes. Confirmed recurring, not one-off: the
  breadcrumb separately names this "the already-known #292 drift gap
  avoided proactively" across TASK-051, TASK-052, and TASK-060 — caught
  only by whoever happened to remember each time, never enforced.
- **Area:** github-workflow
- **Change:** added a CI step to `pr.yml`'s `build-and-test` job that
  regenerates both files and fails the build (`git diff --exit-code`) if
  the committed versions are out of date — the same "verify against the
  real harness" discipline this file already applies via
  `--frozen-lockfile` and `constitution-gate.yml`'s checks.
- **Files:** `.github/workflows/pr.yml`

## 2026-08-07 (3)

- **Friction:** before finalizing `/retro`, cross-checked it against an
  external skill suite (`jsmastery-pro/skills`, cloned for review) for
  patterns worth adapting. Found a real, currently-missing capability:
  `lis-engineering` has zero automated lint/CI check on its Skills
  (frontmatter validity, description length, byte-size sanity) — staleness
  is caught only by human/agent judgment (`engineering-radar`'s heuristic,
  `close`'s uncommitted-Skills check). The external repo enforces this via
  a small `npm run check` script wired into CI. Not a one-off: as Skills
  accumulate, this gap only grows.
- **Area:** other-process
- **Change:** none — deliberately deferred, not declined. This is
  repo-wide tooling (a new script + CI job in `lis-engineering`), not a
  `/retro`-sized targeted edit; scoped out of this run on purpose. Worth
  raising at a future `/close` or `/engineering-radar` pass: a scoped-down
  linter (skip the source repo's cross-agent portability/no-dash rules,
  which don't apply here) checking frontmatter validity and that
  thin-pointer files stay in sync with their canonical target.
- **Files:** none

Two smaller ideas from the same review were folded directly into `/retro`
itself rather than logged as separate friction (skill drafting, not a
session's lived friction): a duplicate-entry check before appending here
(`skills/workflow/retro/SKILL.md`), and an explicit `allowed-tools`
frontmatter declaration (this entry's own commit).

## 2026-08-07 (4)

- **Friction:** landing this same session's own PRs hit a real, undocumented
  GitHub gotcha: deleting a branch that was the **base** of a different,
  still-open, stacked PR (#341's `retro/skill-and-first-fixes`, base of
  #342) permanently closed that PR. `gh pr edit --base` and the equivalent
  `mcp__github__update_pull_request` both failed
  ("Cannot change the base branch of a closed pull request" /
  "state cannot be changed... branch has been deleted"). No data lost (the
  head branch and commit were untouched), but recovery meant opening a
  brand-new PR (#343) from the same head branch, not reusing #342.
- **Area:** github-workflow
- **Change:** added a note to `AGENTS.md`'s merge-discipline bullet:
  before deleting any branch, check whether it's the base of a different
  open PR; retarget or merge that PR first, or confirm none depends on it.
- **Files:** `AGENTS.md`

## 2026-08-07 (5)

- **Friction:** verifying TASK-062's worklist UI with a real headless-browser
  Playwright script, `page.waitForLoadState('networkidle')` called right
  after clicking a Next.js client-side `<Link>`/`router.push()` navigation
  resolved *before* the resulting RSC fetch even started — the click handler
  returns synchronously, and the network happened to already be idle at that
  exact instant. This produced a 100%-reproducible false failure (stale
  `page.url()`, a screenshot of the pre-click page) that looked exactly like
  a real navigation bug in the app, costing real debugging time before being
  root-caused by direct isolation (the identical click, awaited with
  `waitForTimeout` instead, navigated correctly every time). Not a one-off:
  `apps/web` now has several client-side-navigating components (tables with
  `onRowClick`/`router.push()`, `Link`-wrapped tabs/stat tiles), so any
  future verification session driving one of them would hit this cold.
- **Area:** existing-skill:web-verify
- **Change:** added a gotcha to `web-verify/SKILL.md`'s "Drive it" section:
  use `page.waitForURL(<pattern>)` after a click-triggered client-side
  navigation, not `waitForLoadState('networkidle')` — reserve `networkidle`
  for a fresh `page.goto()`/full-page form submission.
- **Files:** `.claude/skills/web-verify/SKILL.md`
