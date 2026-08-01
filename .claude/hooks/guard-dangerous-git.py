import json
import re
import subprocess
import sys

HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)(\w+)\1?")
SEGMENT_SPLIT_RE = re.compile(r"&&|\|\||[;\n|]")
LEADING_GIT_GH_RE = re.compile(r"^(git|gh)\b")


def strip_heredocs(text):
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = HEREDOC_RE.search(line)
        if m:
            delim = m.group(2)
            out.append(line[: m.start()])
            i += 1
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
            i += 1  # skip the delimiter line itself
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def strip_quotes(text):
    result = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "'":
            i += 1
            while i < n and text[i] != "'":
                i += 1
            i += 1
            continue
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                i += 1
            i += 1
            continue
        result.append(c)
        i += 1
    return "".join(result)


def git_gh_segments(command_text):
    structural = strip_quotes(strip_heredocs(command_text))
    segments = [s.strip() for s in SEGMENT_SPLIT_RE.split(structural) if s.strip()]
    return [s for s in segments if LEADING_GIT_GH_RE.match(s)]


def current_remote():
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def deny(message):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "additionalContext": message,
                }
            }
        )
    )
    sys.exit(2)


def main():
    raw = sys.stdin.read()
    try:
        command = json.loads(raw).get("tool_input", {}).get("command", "")
    except Exception:
        command = ""

    for segment in git_gh_segments(command):
        if re.search(r"git\s+reset\s+--hard", segment):
            deny(
                "Blocked: git reset --hard wipes the ENTIRE working tree, not "
                "just the target commit — this caused real data loss on "
                "2026-07-26 (see M0-retrospective.md). Use git restore "
                "<specific-file> instead, or confirm explicitly with the "
                "human first."
            )

        if re.search(r"gh\s+pr\s+merge.*--delete-branch", segment):
            deny(
                "Blocked: combining merge with --delete-branch deleted a "
                "branch holding a real unpushed commit on 2026-07-26 (the "
                "merge was a silent no-op, delete happened anyway). Split "
                "into: gh pr merge <n> --squash, then confirm it landed "
                "(git log origin/main), then delete the branch as its own "
                "separate step."
            )

        if re.match(r"^git\s+push\s+(origin\s+)?main\s*$", segment):
            remote = current_remote()
            if "lis-platform" in remote.lower():
                deny(
                    "Blocked: direct push to main bypasses the required PR "
                    "+ review gate (Rule #0). Branch protection should "
                    "already reject this server-side, but this stops it "
                    "locally first. Open a PR instead. (This check is "
                    "lis-platform-specific — the Rule #0 PR gate — confirmed "
                    "2026-08-01 there is no matching server-side restriction "
                    "on lis-engineering, which documents direct-to-main as "
                    "its own convention.)"
                )

    sys.exit(0)


if __name__ == "__main__":
    main()
