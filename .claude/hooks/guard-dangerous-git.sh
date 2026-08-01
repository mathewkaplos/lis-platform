#!/usr/bin/env bash
input=$(cat)
cmd=$(echo "$input" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

deny() {
  python3 -c "import json; print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','additionalContext':'$1'}}))"
  exit 2
}

if echo "$cmd" | grep -qE 'git reset --hard'; then
  deny "Blocked: git reset --hard wipes the ENTIRE working tree, not just the target commit — this caused real data loss on 2026-07-26 (see M0-retrospective.md). Use git restore <specific-file> instead, or confirm explicitly with the human first."
fi

if echo "$cmd" | grep -qE 'gh pr merge.*--delete-branch'; then
  deny "Blocked: combining merge with --delete-branch deleted a branch holding a real unpushed commit on 2026-07-26 (the merge was a silent no-op, delete happened anyway). Split into: gh pr merge <n> --squash, then confirm it landed (git log origin/main), then delete the branch as its own separate step."
fi

if echo "$cmd" | grep -qE '^\s*git push\s+(origin\s+)?main\s*$'; then
  remote=$(git remote get-url origin 2>/dev/null)
  if echo "$remote" | grep -qi 'lis-platform'; then
    deny "Blocked: direct push to main bypasses the required PR + review gate (Rule #0). Branch protection should already reject this server-side, but this stops it locally first. Open a PR instead. (This check is lis-platform-specific — the Rule #0 PR gate — confirmed 2026-08-01 there is no matching server-side restriction on lis-engineering, which documents direct-to-main as its own convention.)"
  fi
fi

exit 0
