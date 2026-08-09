# Status — 2026-08-09 (session 28)

Last commit on main: `c84568f` (`lis-platform`) / `3375211` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction (a breadcrumb commit can never state its own SHA) — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## TASK-397 merged clean, then exposed a genuine three-attempt production incident (#410) — resolved,
but only once the human's own direct droplet query broke the guessing

Session opened with `/orient`. Picked issue #397 (staging deploy's seed step silently skipped
`haematology-catalog.sql` forever past the first deploy, because the old `seed_count` gate checked
"does any seed data exist" rather than "does *this file's* data exist") — ADR-0022 drafted and
accepted same session, Implementation Proposal approved, implemented, verified locally (fresh seed +
re-seed idempotency check), merged as `lis-platform` PR #408.

**That merge triggered a real automatic staging deploy, which failed** — a pre-existing, previously
dormant bug in `chemistry-catalog.sql`'s eGFR/LDL analyte insert (never having actually run against
staging before, since the old gate had been silently skipping the whole file) hit a genuine
`duplicate key value violates unique constraint "analyte_code_system_value_id_unique"`. Because the
remote deploy script runs under `set -euo pipefail`, this aborted the whole script before
`docker compose up -d api web` could run — a real outage, `api`/`web` stopped and not restarted.
Filed as `lis-platform` issue #410.

**First fix attempt (PR #411) was wrong.** Hypothesized version-drift in `code_system_value` (no
`version` filter on several JOINs), fixed and verified thoroughly *locally* — including deliberately
reproducing a plausible failure shape and confirming the fix held — merged with real confidence. The
resulting second automatic deploy **failed identically**. The true cause was a different table
entirely.

**Second fix attempt (PR #412) was right, because it started from a confirmed fact, not a guess.**
The human ran a direct read-only query against the real staging droplet
(`SELECT id, code_system_value_id FROM unit WHERE code_system_value_id = (...)`) and found two `unit`
rows genuinely referencing the same `code_system_value_id` for `mg/dL` — `unit.code_system_value_id`
has no unique constraint. The eGFR/LDL insert's JOIN through `unit` fanned out against those two rows,
producing two source rows for the same analyte within one `INSERT`'s own result set. Fixed with
`SELECT DISTINCT ON (csv.id)` on all three analyte-insert statements across both seed files (only the
eGFR/LDL one was currently exercised; the other two fixed defensively for the same latent risk).
Reproduced the *exact confirmed* failure locally before merging this time — injected a second `unit`
row matching the real query result, got the identical error against the unfixed code, then confirmed
the fix resolved it against that same corrupted state. The resulting third automatic deploy
**succeeded**, confirmed via direct log inspection (`INSERT 0 5` for the previously-failing statement,
zero errors, `api`/`web` recreated and started, smoke test passed) — not just a green checkmark.

**Real friction along the way, not just the SQL bug itself:** interactively debugging via
`docker compose exec -T postgres psql ...` (no `-c`) looked completely hung twice during the incident
— `-T` suppresses the TTY `psql`'s interactive prompt needs. Root-caused and documented same session
(`docker-pnpm-monorepo-deploy` Skill entry #26, via a dedicated `/retro` invocation) — sibling gotcha
to that Skill's existing entry #10 (the same flag's *stdin-forwarding* effect inside CI heredocs, a
distinct consequence of the same root cause).

## Issue #381 reconciled — already resolved by TASK-070, just never closed

`/orient` found `/qc-violations` (TASK-070, FEAT-020) already links out to the Levey-Jennings chart
(TASK-069) that #381 complained was only reachable by a hand-typed URL — confirmed by reading that
page's own header comment ("folding in issue #381"). Commented and closed with the exact evidence.

## `/close`'s own Engineering Flow Retrospective found three real process gaps this session — one
fixed via `/retro` mid-incident, three more resolved at close via explicit human approval

- **`AGENTS.md`'s own confirm-merge instruction contradicted itself** (line 67 said `git log
  origin/main`, a note nine lines below already explained that gets denied by the auto-mode
  classifier and said to prefer `gh pr view` instead) — found and fixed via `/retro`, `lis-platform`
  PR #409.
- **Finding A** (GraphQL quota exhaustion hit `gh pr merge`/`gh issue create`/`gh pr list`
  independently this session, beyond what AGENTS.md named) and **Finding C** (a bug's root-cause
  hypothesis about *live-environment drift* needs a direct confirming query before the fix is
  written, not after a first guess fails — the exact lesson PR #411's failure taught the hard way) —
  both approved and landed in `AGENTS.md`, `lis-platform` PR #414 (CI green as of this breadcrumb,
  **still awaiting the human's own merge** — `AGENTS.md` changes need the human to run the git-level
  steps directly, per this file's own standing rule).
- **Finding B** (the deploy script's seed step was fatal under `set -e`, while the Keycloak block a
  few lines below it was deliberately made non-fatal after an almost identical 2026-08-03 incident —
  this session's own #410 outage was the exact failure class that fix was written to prevent, just
  never applied to the seed step) — approved and landed, `lis-platform` PR #415, confirmed via a real
  subsequent deploy that the happy path is unaffected (zero output/behavior change on success).

**Manual Verification Checklist:** this session's own confirmation that staging is healthy came from
CI log inspection (seed step SQL output, container start messages, smoke-test-inclusive job success),
not a human loading the real staging URL in a browser — still worth an independent look before fully
trusting it, same discipline `web-verify` already applies elsewhere.

**Next session:** PR #414 needs a human merge (small, docs-only, CI already green — the only reason
it's not already landed is `AGENTS.md`'s own sensitive-file carve-out). M5's three remaining open
features (FEAT-022 Worklist v2, FEAT-024 Peripheral film structured reporting, FEAT-025 Delta checks)
each still need their own kickoff (research → proposal → ADR) before implementation — none has a
ready-to-`/develop` task yet, unchanged from session 27's own note.
