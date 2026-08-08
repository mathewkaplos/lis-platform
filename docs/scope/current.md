# Status — 2026-08-08 (session 23)

Last commit on main: `460bf33` — "fix: close-retro findings -- import-to-github.sh GraphQL waste, gh pr edit note (#380)".

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.** Same
convention prior sessions already established — every session's own commits, PR descriptions, and
Skill/ADR entries carry the real detail; this file's job is orientation for the *next* session, not
a permanent archive.

## Session opened by fixing a real gap from session 22: FEAT-021/TASK-065/TASK-066 issues had never
actually closed on GitHub, despite being fully merged

`/orient`'s milestone cross-check (CHECKLIST.md item 9) found #30 (FEAT-021), #360 (TASK-065), #361
(TASK-066) still **open** on GitHub even though PRs #363/#366 were merged — both PR bodies referenced
their issues as `Implements TASK-N (#N)` rather than a bare `Closes #N`, so GitHub's closing-keyword
parser never fired. Closed all three manually. Root cause traced further than the symptom: the
`Closes #N` convention was already documented in `AGENTS.md` (from an earlier #93/#94 incident) but
never linked from `develop/SKILL.md`, the Skill that actually walks through implementing/shipping a
task — added as a new step 5 there, plus a `/retro` log entry (`CHANGELOG.md`).

## FEAT-019 (Levey-Jennings + Westgard engine) kicked off, fully implemented (all three tasks), and
closed — all in this same session

M5's four unblocked open features were FEAT-019/FEAT-022/FEAT-023/FEAT-025; FEAT-019 chosen as the
direct next link in the QC/safety thread FEAT-018/FEAT-021 already built this milestone, and the only
one that unblocks a second Critical-priority feature (FEAT-020, QC gating of result release).

**ADR-0018** (accepted): three real gaps KB-27 leaves open, resolved — a fixed default Westgard rule
set (1-2s/1-3s/2-2s/R-4s/4-1s/10x), not a speculative per-tenant configurable rule-pack table;
synchronous same-transaction evaluation (no event bus exists yet); and a nearest-same-day-
sibling-level pairing heuristic for the cross-level R-4s rule, since no "run" entity exists in the
schema (a real `qc_run` table deliberately deferred until analyzer integration, FEAT-027, makes
multi-level batch entry a structured event).

**TASK-067 (Westgard multirule evaluation engine), PR #376, closing #372.** Pure-function evaluator
(`packages/domain/src/qc-westgard.ts`) + new `qc_rule_violation` table (composite FK to
`observation.(id, created_at)`, `database-design` entry #10's own pattern) + wired into
`recordResult()`'s existing transaction, folding violations into the same audit event
(`TASK-065`'s `criticalNotificationId` precedent). Real finding: e2e tests sharing one seeded analyte
let R-4s's `analyteId`-scoped sibling-matching leak across unrelated tests — fixed via per-test
analyte isolation, written up as `qc-westgard` Skill entry #8. 202/202 `apps/api` e2e green.

**TASK-068 (Levey-Jennings chart data API), PR #377, closing #373.** `GET /v1/control-lots/:id/chart`
— mean/SD band + ordered points with z-scores + violations. Real finding: `chemistry-catalog.sql`'s
seed only ever inserts quantity-dataType analytes, so the "400 for non-quantity" test needed a
synthetic coded-analyte fixture. 208/208 `apps/api` e2e green; `openapi.json`/SDK regenerated
(this route IS `@ZodResponse`-bound, confirmed purely additive).

**TASK-069 (Levey-Jennings chart UI), PR #378, closing #374 — FEAT-019 now fully implemented, all
three tasks done, #28 manually closed.** `/control-lots/:id/chart` — hand-rolled inline SVG chart (no
new dependency; none existed in `apps/web` and the chart is simple enough to hand-roll against
existing semantic color tokens), `DataTable` below it as the literal "a11y data-table alternative"
Stitch §14.4 itself names. No sidebar nav entry yet (no control-lot list screen exists to link from —
see below) and no level-selector/date-range (out of TASK-068's own single-lot endpoint scope), both
deliberate narrowings. Two real findings, both found via an actual browser verification run
(`web-verify` Skill), neither caught by typecheck/lint/build: (1) `DataTable`'s `columns` prop carries
functions, and rendering it from a plain Server Component throws a real RSC serialization error at
request time — fixed by marking the wrapping component `'use client'`; (2) `<svg height="auto">` is
invalid (SVG length attributes reject the CSS keyword `"auto"`) — a real, easy-to-miss console error,
fixed via a CSS class instead. Both written up as `frontend-design` Skill entry #6. Verified with a
real seeded control lot (4 QC results, the last a genuine 1-3s rejection via the real API),
screenshotted in light + dark mode; all four states confirmed (populated, empty, 404, error).

## `/close` this session: Pre-Close Report found the stale breadcrumb (this file, now fixed) plus two
Engineering Flow Retrospective findings, both approved and fixed

1. **`import-to-github.sh`'s `populate_fields` (Step 6) re-fetched GraphQL project-field data for the
   entire ~130-item backlog on every run, not just newly-created issues** — a 3-issue kickoff burned
   the shared 5,000/hr GraphQL quota, blocking `gh pr create`/`checks`/`merge` for ~35-40 minutes
   mid-session (worked around via direct REST calls at the time). Fixed via PR #380: now tracks which
   IDs are actually created each invocation and only populates fields for those — verified via a real
   `--dry-run` (completes cleanly, does no Step 6 work, `import-map.json` untouched).
2. **`gh pr edit --body`/`--title` fails outright on this repo** (a Projects-classic-sunset GraphQL
   error), even for a trivial body-only edit — documented in `AGENTS.md`'s PR conventions with the
   working REST substitute (`gh api repos/.../pulls/<n> -X PATCH -f body=...`), same PR #380.

**Manual Verification Checklist finding, turned into a real follow-up issue:** TASK-069's chart page
is reachable only by a hand-typed direct URL — no control-lot list/QC dashboard screen exists yet to
link from. Filed as **issue #381**, flagged as likely FEAT-020's own natural territory (it already
needs to read the same `qc_rule_violation` data for its release gate) but not assumed — a real
decision for whoever picks up the next QC-related feature.

**Two Manual Verification Checklist items explicitly deferred, not resolved:** a lab-domain-expert
visual review of the chart's SD-band/rule-coloring rendering, and a real human click-through on the
actual public staging URL — neither is available from this environment (no lab-QC domain expert, no
tailnet/staging credentials), same standing gap already noted for an unrelated feature in session
22's own breadcrumb. Worth a look next time a human with the right access/background is at a
computer, not because anything indicates a problem.

**Next milestone/feature: FEAT-020 (QC gating of result release) is the natural next M5 feature** —
it directly reads the `qc_rule_violation` table this session's FEAT-019 built, closing the actual
safety payoff KB-27 names (holding patient-result release on a rejection-rule violation). Not
started this session; a future `/orient` should still weigh it against M5's other unblocked features
(FEAT-022, FEAT-023, FEAT-025) fresh rather than assuming it's automatically next.
