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
