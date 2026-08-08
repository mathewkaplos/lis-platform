# Status — 2026-08-08 (session 25)

Last commit on main: `80aa303` (`lis-engineering`) / `8ab5628` (`lis-platform`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction (a breadcrumb commit can never state its own SHA) — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## FEAT-020 (QC gating of result release) implemented, merged, and closed this session — TASK-070
(#384) and its parent feature (#29) both closed

Session opened with `/orient`; the human approved starting `/develop` TASK-070 straight away.
Backend: `FinalizationRollupInterceptor` gained a third gate check (ADR-0019 Decision 1/2, analyte-
scoped, not analyte×instrument — `control_lot.instrumentId` is still never populated by any code);
`qc_rule_violation` gained a resolve lifecycle (`resolvedAt`/`resolvedByUserId`, migration 0022); a
new `resolve_qc` capability was added, granted to a **new `qa` Keycloak realm role** (not `verifier`/
`technologist` — resolved this session, per ADR-0019 Decision 3 and KB-10's own persona list, since
the proposal deliberately deferred this exact question to implementation start); `POST /v1/qc-rule-
violations/:id/resolve` and `GET /v1/qc-rule-violations` (folding in #381) shipped. Frontend: a
minimal `/qc-violations` list + Resolve screen, gated by `hasQaRole()`, added to the sidebar nav.

**A real bug was caught only by live browser verification, not the e2e suite:** the list route's
`?resolved=false` query param was double-validated (once by the global Zod pipe, once by the route's
own explicit pipe) — the second pass ran against an already-boolean-transformed value and always
failed. Fixed by dropping the schema-level transform in favor of a raw-string comparison in the
handler. **A second real bug was caught only by CI, never locally across multiple runs:**
`qc-westgard.e2e-spec.ts`/`qc-chart.e2e-spec.ts` each grab a non-deterministic `LIMIT N` slice of real
shared seeded analytes (no `ORDER BY`) and, by their own pre-existing design, never resolved the
rejection violations they create — harmless before this session's gate existed, but capable of
blocking any other spec file's `finalize()` calls (confirmed: `worklist.e2e-spec.ts` 409'd on CI) once
it did. Fixed by having both files resolve everything they create in `afterAll`; documented as
`domain/qc-westgard` Skill entry #9.

Landed via `lis-platform` PR #387 (squash-merged). #384 closed automatically (`Closes #384`); #29
(the parent feature issue — TASK-070 was its sole, undivided task) closed manually with an
explanatory comment, since GitHub only auto-closes the literal referenced issue.

## Two more real gaps found and fixed the same session, outside TASK-070's own diff

1. `Skill(skill: "develop")` returned `Unknown skill` at `/develop` start — the entrypoint existed in
   `close`/`engineering-radar`/`orient`/`retro`/`web-verify` but not `develop`. Fixed same-day
   (`.claude/skills/develop/SKILL.md`, mirroring the existing pattern), `lis-platform` PR #388.
2. `/retro` (invoked mid-session, not at close): a standalone, already-split `git fetch origin main`
   — following AGENTS.md's own existing "split into separate calls" guidance — was denied by the
   auto-mode classifier twice while confirming PR #387 had landed, contradicting that guidance's
   premise. `gh pr view <n> --json state,mergedAt` worked immediately both times and answers "did my
   merge land" more directly. AGENTS.md's merge-autonomy bullet extended with this recurrence,
   `lis-platform` PR #389, logged to `CHANGELOG.md` (2026-08-08 (5)).

Both PRs needed `gh api .../pulls/<n>/update-branch` before merging — each was opened while an
earlier PR from the same session was still the merge target, and branch protection requires the head
branch be up to date, not just green. Confirmed twice this session; this exact mechanism (generic to
branch protection, not specific to `/close`) is now documented directly in `close/SKILL.md` step 11.

## `/close` this session found one new Engineering Flow Retrospective finding, fixed the same session

`pnpm --filter @lis/db migrate` printed `Migrations applied.` with zero errors after generating
migration 0022 — but the new columns were verifiably absent from the live table
(`docker exec ... psql -c '\d qc_rule_violation'`). The local Postgres container had been running for
hours already at session start (carried over, not freshly started), and `drizzle.__drizzle_migrations`'s
row count already matched the on-disk migration-file count before this migration even existed — only
`pnpm db:reset` actually fixed it; the exact mechanism wasn't conclusively isolated, only worked
around. Documented as `engineering/database-design` Skill entry #11, so a future session recognizes
the symptom instead of trusting `migrate`'s own success message.

**Manual Verification Checklist:** the `/qc-violations` screen and its Resolve action were verified
this session via a scripted headless-browser (Playwright) pass as both a `qa`-role and a non-`qa`-role
user (screenshots taken, no console errors) — but a human's own independent click-through is still
recommended, not yet done as of this breadcrumb. A known, undecided UX gap was surfaced and filed as
**issue #390**: a technologist hitting the new QC gate sees only a raw 409, with no in-context
indicator pointing them at `/qc-violations`.

**Next session:** M5's remaining unblocked features (FEAT-022 Worklist v2, FEAT-023 Haematology CBC,
FEAT-025 Delta checks) each still need their own kickoff (research → proposal → ADR) before
implementation — none has a ready-to-`/develop` task the way TASK-070 did this session. Issue #390
(QC-held indicator) is a small, undecided follow-up worth resolving at whichever kickoff picks it up,
not yet scoped to a specific feature.
