---
description: Run before ending a session. Checks for anything left pending
  that would otherwise silently carry over — uncommitted changes, unmerged
  PRs, leftover debug/temporary code, unwatched dispatched workflows,
  unresolved ADR/proposal drafts, and a stale breadcrumb. Read-only — never
  auto-fixes, only reports what needs your decision before you go.
argument-hint: (no arguments needed)
---

Follow the full checklist at
~/work/lis-engineering/.claude/skills/close/SKILL.md — same checks, same
report format. This copy exists only so /close resolves from this repo too;
the canonical version lives in lis-engineering.
