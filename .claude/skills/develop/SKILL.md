---
description: Use to implement a task, and ONLY after its parent feature has
  an Implementation Proposal with Status APPROVED. If no approved proposal
  exists, refuse and invoke the `plan` skill instead.
argument-hint: <TASK-NNN or issue number>
---

Read and follow the develop checklist in full, exactly as written — it is
the actual source of the workflow steps and rules; this file is only the
entrypoint that makes it callable as a Skill by name:
~/work/lis-engineering/skills/workflow/develop/SKILL.md

Do not duplicate that file's content here. If it drifts from this pointer,
fix the path here or the content there — never fork a second copy of the
checklist itself.
