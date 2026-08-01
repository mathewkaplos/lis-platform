#!/usr/bin/env bash
# Parses tool_input.command structurally (strips heredoc bodies and quoted
# argument text, then only checks segments whose actual leading executable
# is git/gh) before applying any dangerous-pattern check. A dangerous phrase
# inside quoted data (a --body string, a commit message, a heredoc) must
# never trigger the same guard as the phrase being the command executed —
# confirmed as a real false positive 2026-08-01 (a PR --body describing
# "git reset --hard" in a test-plan bullet tripped the old whole-string
# grep). Logic lives in guard-dangerous-git.py, not inlined here: a
# `python3 - <<'EOF'` heredoc would feed the heredoc to python as its own
# program source, leaving sys.stdin already at EOF for the real tool_input
# JSON — a real bug caught during this fix's own test pass, silently
# disabling every check (always exit 0) rather than just the one meant to
# be relaxed.
exec python3 "$(dirname "$0")/guard-dangerous-git.py"
