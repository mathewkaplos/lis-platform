# GitHub-Native Issue Import

This directory converts the LIS Product Backlog into 121 individual, GitHub-native issue files
and a script that imports all of them into a real repository via the GitHub CLI.

## Contents

```
github/
├── README.md                    ← this file
└── issues/
    ├── manifest.json            ← machine-readable index the import script reads
    ├── import-map.json          ← created on first run; maps backlog ID -> real issue number
    ├── epics/                   ← 9 files, EPIC-001 .. EPIC-009
    ├── features/                ← 50 files, FEAT-001 .. FEAT-050
    └── tasks/                   ← 62 files, TASK-001 .. TASK-062 (M0-M4 only; M5-M10 features
                                     are decomposed into tasks at their milestone kickoff, per
                                     the Execution Plan's rolling-wave planning approach)
└── import-to-github.sh          ← the gh CLI import script
```

Every issue file has YAML frontmatter (id, type, milestone, priority, dependencies, labels,
status) followed by a full GitHub-flavored-Markdown body: description/purpose, dependencies,
required Skills, architecture documents to reference, ADRs to reference, Google Stitch prompts
required (features only), acceptance criteria, a full checklist (Implementation Proposal,
backend/frontend/database/testing/documentation work), and a Definition of Done.

## Prerequisites

1. **GitHub CLI** installed: <https://cli.github.com>
2. **`jq`** installed (`sudo apt install jq` / `brew install jq`)
3. Authenticated: `gh auth login`
4. The target repository already exists on GitHub (the script does not create the repo itself)

## Usage

Run from the **root of the repository** that will own these issues (so that `github/issues/`
resolves correctly):

```bash
./github/import-to-github.sh yourorg/lis-platform --project "LIS Roadmap"
```

Add `--dry-run` first to see exactly what the script would do without making any changes:

```bash
./github/import-to-github.sh yourorg/lis-platform --project "LIS Roadmap" --dry-run
```

## What it does, in order

1. Creates every label used across the backlog (`type:*`, `priority:*`, `area:*`,
   `milestone:m0`–`milestone:m10`, `size:*`, `roadmap`, `blocked`, `needs-clinical-review`,
   `invariant-risk`) — idempotent, safe to re-run.
2. Creates GitHub Milestones `M0` through `M10` with descriptions from the Execution Plan.
3. Creates (or finds) a GitHub Project (v2) named `LIS Roadmap` and ensures the custom fields
   `Type`, `Backlog ID`, `Priority`, `Effort`, `Area`, `Status`.
4. Creates all 121 issues **in dependency order** — Epics, then Features, then Tasks — so that
   by the time a Feature references its Epic, or a Task references its Feature, the referenced
   issue already exists and can be linked by real number.
5. Rewrites every `<!-- gh-issue-ref:ID -->` marker left in the issue bodies into a real
   `(#123)` link once the referenced issue's number is known.
6. Adds every created issue to the Project and populates its custom fields.
7. Writes `github/issues/import-map.json` — a permanent record of `backlog ID -> issue number`.

## Safety and re-running

The script is **idempotent**. It checks `import-map.json` before creating each issue and skips
any backlog ID already imported. If it fails partway through (rate limit, network blip), just
run it again — it resumes where it left off rather than duplicating issues.

## After import

- Set up the Project board's views (Board grouped by `Status`, or by `Milestone`) in the
  GitHub UI — the CLI can add fields and items but board *view* configuration is a UI-only step.
- Protect `main` per the Engineering Operations Manual §12 (require PR, require green CI,
  require linear history, disallow force-push).
- Move an issue's `Status` field to `Ready` only once its Implementation Proposal is approved,
  per Rule #0.

## Jira alternative

If you use Jira instead of GitHub Projects, use `LIS-Product-Backlog.csv` (from the companion
Product Backlog deliverable) instead of this script — the CSV imports directly and the mapping
instructions are in that file's final section. This `github/` directory is specifically for
teams standing up native GitHub Issues + Projects.
