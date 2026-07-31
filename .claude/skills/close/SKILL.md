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
report formats. This copy exists only so /close resolves from this repo too;
the canonical version lives in lis-engineering.

This Skill produces two reports, not one, per the canonical file:

1. **Pre-Close Report** (steps 1–8) — the first invocation in a session.
   Written verbatim (not re-summarized) to
   `~/work/lis-engineering/session-close-reports/<YYYY-MM-DD>-<HHMM>-pre.md`
   (24-hour local time, never overwriting an existing file).
2. **Final Close Report** (step 9) — the next invocation, after the human
   has responded to the Pre-Close Report's pending items. Re-runs all 7
   checks fresh (never assume something is fixed just because the human
   said so — verify with real commands), reads the most recent `-pre.md`
   directly (not conversation memory), and resolves each of its pending
   items to exactly one of: **Fixed** (confirmed via stated
   command/evidence), **Deferred** (human's stated reason quoted), or
   **STILL OUTSTANDING** (neither fixed nor explicitly deferred — should be
   rare, flag clearly). Written to
   `~/work/lis-engineering/session-close-reports/<YYYY-MM-DD>-<HHMM>-final.md`.

A session is not genuinely closed until a `-final.md` exists with zero
STILL OUTSTANDING items. If the human tries to end a session with only a
`-pre.md` on record, say so plainly rather than treating the session as
done.

Writing whichever report applies is not optional and not something to ask
permission for — it's the report's own persistence, not a "fix." State the
exact file path in the chat output, as the last thing in the turn.
