import json
import os
import re
import subprocess
import sys

HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)(\w+)\1?")
SEGMENT_SPLIT_RE = re.compile(r"&&|\|\||[;\n|]")
LEADING_GIT_GH_RE = re.compile(r"^(git|gh)\b")
CD_RE = re.compile(r"^cd(\s+(.*))?$")


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


def ordered_segments(command_text):
    structural = strip_quotes(strip_heredocs(command_text))
    return [s.strip() for s in SEGMENT_SPLIT_RE.split(structural) if s.strip()]


def resolve_cd_target(cwd, segment):
    m = CD_RE.match(segment)
    target = (m.group(2) or "").strip() if m else ""
    if not target or target == "~":
        return os.path.expanduser("~")
    if target == "-":
        return cwd  # OLDPWD unknown to us; best effort, leave unchanged
    target = os.path.expanduser(target)
    if not os.path.isabs(target):
        target = os.path.normpath(os.path.join(cwd, target))
    return target


def remote_for_dir(directory):
    try:
        result = subprocess.run(
            ["git", "-C", directory, "remote", "get-url", "origin"],
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

    # PreToolUse fires before the command runs, including before any
    # leading `cd` in it -- the hook's own cwd is always wherever the
    # shell already was, not wherever a `cd repo && ...` in THIS command
    # is about to go. Walk segments in order, tracking a simulated cwd
    # through any `cd` segments, so the remote check below reflects where
    # the git/gh segment would actually execute, not the hook's ambient
    # cwd. (A real regression, not hypothetical: the ambient-cwd version
    # of this check blocked a real `cd ~/work/lis-engineering && git push
    # origin main` because the hook process itself was still rooted in
    # lis-platform when it ran.)
    cwd = os.getcwd()
    for segment in ordered_segments(command):
        if CD_RE.match(segment):
            cwd = resolve_cd_target(cwd, segment)
            continue

        if not LEADING_GIT_GH_RE.match(segment):
            continue

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
            remote = remote_for_dir(cwd)
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
