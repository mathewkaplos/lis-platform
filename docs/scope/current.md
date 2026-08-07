# Status — 2026-08-07 (session 21)

Last commit on main: `da3322a` — "docs: gh GraphQL rate-limit gotcha + fallback (/retro) (#357)".

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.** Session
12 itself already established this same "see git history" convention for anything before it; this
session's own `/close` truncated the file the rest of the way (it had grown to 139KB/1,784 lines
across sessions 12-20, flagged as documentation drift by this session's own `/orient` and never
pruned until now) rather than letting it keep growing unbounded. Nothing about a specific prior
session's findings is lost — every session's own commits, PR descriptions, and Skill/ADR entries
already carry the real detail; this file's job is orientation for the *next* session, not a
permanent archive.

## M4 (Chemistry Result Loop, the thesis milestone) closed at the start of this session; M5's first
feature (FEAT-018, #27) was kicked off, fully implemented, and closed — all in this same session

Session opened via `/orient`: M4 was confirmed genuinely, fully done (FEAT-014/015/016/017 all
closed, `EPIC-004`'s remaining "open" signal correctly explained by it spanning M5 too, not a real
gap). M5 ("Make It Dependable — QC, criticals, Haematology") had 8 open features, none started;
FEAT-018 (QC materials & results as Observations) was recommended and approved as M5's entry point
— its one dependency (FEAT-016) was already merged.

**Real, load-bearing finding from this session's own kickoff research, not present in FEAT-018's
issue text:** KB-27's own core design — "a QC result is an Observation whose subject is a control
material, not a patient" — could not be built against the schema as it existed.
`observation.patientId`/`orderedTestId`/`specimenId` were all `NOT NULL`. **ADR-0015** (accepted)
resolves it: a new `isControl` discriminator, a new `controlLotId` FK to a new `control_lot` table,
the three existing columns relaxed to nullable, enforced by a `chk_observation_subject` CHECK
constraint so every row is unambiguously a patient result or a QC result, never neither, never both.

**TASK-063 (Control lot & QC observation schema), PR #353, closing #350.** Delivered exactly per
ADR-0015. Real finding during implementation: Postgres only permits table-qualified column
references (`"observation"."col"`) inside a CHECK clause that's part of the *original* `CREATE
TABLE` — a CHECK constraint added later via `ALTER TABLE ADD CONSTRAINT` (this one) must use bare
column names instead, or it fails with `missing FROM-clause entry for table "observation"`. Fixed;
written up as `domain/qc-westgard` Skill + `database-design` Skill entry #9. A second, real finding:
the nullability widening broke real, existing type-checking in `observation.controller.ts`'s DTO
mappers (fixed with a narrow, commented non-null assertion — those routes only ever read
patient-flow rows). 157/157 `apps/api` e2e suite green on a clean DB; `rls-check`/`golden-check`
green; repo-wide typecheck/lint/build green.

**TASK-064 (Control lot QC result entry & query API), PR #354, closing #351 — FEAT-018 (#27) now
fully implemented, both tasks done, issue closed.** `GET/POST /v1/control-lots/:id/results`.
Every POST is a plain INSERT, never an upsert (a control lot's QC history is a real time series,
not a single current-result concept like a patient analyte); audited unconditionally via the
existing `enter_result` capability (no new capability). Real finding: `AuditInterceptor` requires
the handler return `{ resourceId, before?, after? }`, not a flat DTO — a flat return compiles fine
and only 500s at real request time (`writeAuditEvent`'s `resourceId` column is `NOT NULL`). Fixed;
written up as `api-design` Skill entry #15. 163/163 `apps/api` e2e suite green on a clean DB
(6 new HTTP-level tests); `openapi.json`/SDK regenerated (CI-enforced); repo-wide checks green.

## `/retro` ran three times this session, one cycle per real finding above plus a tooling gotcha —
all three fixed and merged

1. `engineering/api-design` Skill entry #15 (AuditInterceptor return-shape contract) —
   lis-engineering `09a2ff3`.
2. `engineering/database-design` Skill entry #9 (CHECK constraint table-qualification) —
   lis-engineering `8df7a6e`.
3. `AGENTS.md` (`gh`'s GraphQL-backed subcommands draw from a separate, independently-exhaustible
   rate-limit bucket from REST — `gh pr create`/`gh pr merge` failed repeatedly with a GraphQL
   rate-limit error this session while REST still had thousands of calls left; check
   `gh api rate_limit --jq '.resources.graphql'`, fall back to `gh api ... -X POST`/`-X PUT`) —
   lis-platform PR #357, merged. Applied at the human's explicit request (`AGENTS.md` edits
   otherwise skip the autonomous git flow per this project's own standing rule).

## `/close` this session: Pre-Close Report found a real stale breadcrumb (this file, now fixed by
this entry) plus one open process-friction finding

The Pre-Close Report (`~/work/lis-engineering/session-close-reports/2026-08-07-1945-pre.md`) found
this file's own "Last commit on main" seven commits stale (not the expected one-commit post-close-out
lag), and a second, distinct issue: session 20's own breadcrumb prose claimed a `web-verify` fix was
"not yet applied" when it had actually already shipped in the very same commit that wrote that
claim — a real self-inconsistency, not a live gap, worth remembering when writing future entries
("don't describe a pending item your own commit just resolved"). Also drafted, approved, and applied
a fix for a real, twice-recurring-this-session finding: the Claude Code auto-mode classifier can
deny a compound Bash command that mixes a read-only git step (`fetch`/`checkout`) with a further
chained step during the standard merge → confirm → cleanup sequence — `AGENTS.md`'s merge-autonomy
bullet now says to run those as separate individual tool calls, not chained with `&&`.

**Next milestone/feature not yet identified for a future session** — M5 has 7 more unstarted
features (FEAT-019 Levey-Jennings/Westgard engine, FEAT-020 QC gating of result release, FEAT-021
critical notification/read-back/escalation, FEAT-022 worklist v2, FEAT-023 Haematology CBC +
differential, FEAT-024 peripheral film structured reporting, FEAT-025 delta checks). KB-27's own
pipeline ordering (QC persistence → Westgard evaluation → release gate) points at FEAT-019 as the
literal next step in that specific chain, but FEAT-021 (critical notification) has no stated
dependency on QC at all and could be pulled forward independently — a future `/orient` should run
real milestone/next-task discovery fresh, not assume FEAT-019 is automatically next just because it
continues the immediately-preceding thread.
