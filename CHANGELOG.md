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
