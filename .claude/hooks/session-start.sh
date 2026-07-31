#!/usr/bin/env bash
echo "IMPORTANT: Your FIRST message in this session must repeat the block below back to the user verbatim, so they can see it — do not just silently hold it as context."
echo "=== AUTO-ORIENTATION (injected by SessionStart hook) ==="
echo "--- lis-platform ---"
git status --short --branch
echo "--- lis-engineering ---"
(cd ~/work/lis-engineering && git status --short --branch)
echo "--- CI (last 3 runs on main) ---"
gh run list --limit 3 2>&1
echo "--- breadcrumb ---"
cat docs/scope/current.md 2>&1
echo "=== END AUTO-ORIENTATION ==="
echo ""
echo "Now complete items 7-18 of playbooks/session-start/CHECKLIST.md"
echo "(milestone check, Constitution, ADRs, Skills, drift, Session Report)."
echo "Do NOT begin implementation until the Session Report is posted and"
echo "the human has responded — this is Rule #0."
echo ""
echo "STANDING RULE (AGENTS.md, Rules of engagement): whenever a real bug,"
echo "gap, or gotcha is discovered — not a hypothetical — check whether an"
echo "existing Skill should be extended with it, or whether it warrants a"
echo "new Skill entirely. Do this the same day, before moving to the next"
echo "task. Do not wait to be asked."
