---
description: Run full session-start orientation — the CHECKLIST, the
  engineering-radar Skill, and produce the Session Report with the
  Engineering Action Plan first. Use at the start of every session, or
  whenever asked to re-orient.
argument-hint: (no arguments needed)
---

Follow the session-start playbook exactly:
~/work/lis-engineering/playbooks/session-start/CHECKLIST.md

Invoke the engineering-radar Skill as part of orientation — call the Skill
tool with skill: "engineering-radar" (it is a registered Skill; this repo has
its own thin entrypoint at .claude/skills/engineering-radar/SKILL.md, which
points at the real checklist in lis-engineering). If that call ever reports
the skill as unavailable (e.g. newly registered and not yet loaded into this
session's skill listing), fall back to reading the underlying file directly:
~/work/lis-engineering/skills/workflow/engineering-radar/SKILL.md

Produce the Session Report per the current template:
~/work/lis-engineering/playbooks/session-start/SESSION_REPORT_TEMPLATE.md —
Engineering Action Plan first. Reason across all signal categories for item 2
— not just sequential backlog order.

Stop after posting the report. Per Rule #0, wait for the human's response
before any implementation, commit, or PR.
