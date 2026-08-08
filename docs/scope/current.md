# Status — 2026-08-08 (session 22)

Last commit on main: `810a41d` — "fix: wire SCHEDULER_DATABASE_URL/lis_scheduler into staging deploy pipeline (#368)".

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.** Same
convention session 12/21 already established — every session's own commits, PR descriptions, and
Skill/ADR entries carry the real detail; this file's job is orientation for the *next* session, not
a permanent archive.

## FEAT-021 (Critical notification, read-back & escalation) kicked off, fully implemented (both
tasks), and closed — all in this same session

Session opened via `/orient`. Three open M5 features had zero unmet dependencies (FEAT-019,
FEAT-021, FEAT-023); FEAT-021 was chosen because it closes a real, already-identified gap against
**Constitution Law #3** ("documented notification with read-back"), rather than opening new domain
breadth or continuing a chain whose safety payoff doesn't land until a later feature ships.

**Real, load-bearing finding from kickoff research, not present in FEAT-021's issue text:**
`finalize()` already computes `criticalDetected` (TASK-054) — detection isn't this feature's gap,
only the notification/read-back/escalation half is. **ADR-0016** (accepted) resolves the schema
mechanism: a new, decoupled `critical_notification` entity, not a change to `verify()`'s own shape,
with the finalization-gate widening deliberately sequenced to a second task.

**TASK-065 (Critical notification record, read-back capture & query), PR #363, closing #360.**
`critical_notification` table + `finalize()` creation hook + acknowledge/query endpoints. Three real
findings: (1) `observation`'s composite PK `(id, created_at)` post-partitioning means any new FK to
it needs a companion `*_created_at` column, not a plain single-column FK; (2) that companion value
read back through a JS `Date` never round-trips to Postgres's microsecond `now()`, breaking the
composite FK — fixed with a server-side subquery instead of the JS-parsed value; (3) a DTO
unnecessarily used nestjs-zod's discriminated-union workaround, silently corrupting an unrelated
route's OpenAPI schema — caught by `apps/web`'s own build. 175/175 `apps/api` e2e suite green;
written up as `database-design` Skill entry #10 (the FK/timestamp finding).

**TASK-066 (Escalation timer & finalization-gate widening), PR #366, closing #361 — FEAT-021 now
fully implemented, both tasks done, issue closed.** Widened `FinalizationRollupInterceptor`'s gate:
verification alone no longer unblocks finalization for a critical — its `critical_notification` must
also be `acknowledged`. Added `CriticalNotificationEscalationService` (`@nestjs/schedule`, 5 min
poll, 30 min window). **ADR-0017** (accepted): a new `lis_scheduler` DB role, `NOBYPASSRLS`,
column-scoped `SELECT(tenant_id, created_at)` via a role-specific RLS policy restricted to pending
rows — the escalation job's only cross-tenant capability; the actual mutating write stays fully
`lis_app`/RLS-scoped per tenant. Two real findings, both fixed forward as separate migrations (never
editing a past one): Postgres's 1-arg `current_setting()` throws when unset rather than returning
null, aborting the whole OR'd-policy query before the new role's own policy ever evaluated
(migration 0019); Postgres's column-level GRANT model requires `SELECT` on every column referenced
*anywhere* in a query, including a `WHERE` clause, not just the returned columns (migration 0020).
182/182 `apps/api` e2e suite green; written up as `rls-multi-tenancy` Skill entry #5.

## A real staging outage happened mid-session, caused by TASK-066's own merge, and was found and
fixed before this session's `/close`

TASK-066's PR wired `SCHEDULER_DATABASE_URL` into local dev (`.env.example`) and `pr.yml`'s CI, but
not the separate staging deploy pipeline (`deploy-staging.yml`/`docker-compose.staging.yml`) —
`scheduler-db.ts`'s `requiredEnv()` threw at module load, crash-looping the `api` container the
moment TASK-066 merged. Found via a failed `Deploy to Staging` run (not proactively — it surfaced
during this session's own `/close`), diagnosed from the real smoke-test logs (`Container ... is
restarting`), and fixed same-session: PR #368 mirrors `APP_DATABASE_URL`'s own pattern for the new
var, adds an `ALTER ROLE lis_scheduler WITH PASSWORD` step, and a new `SCHEDULER_DB_PASSWORD` repo
secret was set. The resulting redeploy was directly confirmed green (both smoke-test steps passed,
not just the merge commit's own checkmark).

## `/retro` ran three times this session — all fixed and merged

1. `database-design` Skill entry #10 (composite-FK-companion-column precision trap, generalizing
   entry #8's UPDATE-WHERE finding to INSERT) — `lis-engineering` `d5c4554`.
2. `rls-multi-tenancy` Skill entry #5 (a second role-scoped RLS policy doesn't help if the table's
   existing policy throws rather than returns null for that role) — `lis-engineering` `4a782cd`.
3. (Named above under TASK-065) `database-design` entry #10 covers both real DB findings from that
   task in one entry, per the retro loop's own "one friction, one fix" discipline applied to the
   single most generalizable of the two.

## `/close` this session: Pre-Close Report found the stale breadcrumb (this file, now fixed) plus
two Engineering Flow Retrospective findings, both approved and applied

1. **`docker-pnpm-monorepo-deploy` Skill entry #25** (the staging env-var-drift finding above, made
   reusable): before merging a PR that adds a new `requiredEnv()`'d variable, grep
   `deploy-staging.yml`/`docker-compose.staging.yml` for it too, not just `pr.yml`/`.env.example` —
   three independently-maintained env-wiring surfaces, no automated check keeps them in sync (same
   shape of gap the openapi/sdk drift check already closed for a different surface, session 21's own
   `/retro`). A full automated check (extract `requiredEnv()` names, cross-reference all three
   files) was named as the more valuable but more expensive option — not built this session, a real
   candidate for a future one.
2. **`close/SKILL.md` item 11's PR-base-staleness note, broadened**: the "a PR needs
   `update-branch` after a sibling PR merges" mechanism isn't only a close-out-multi-PR-resolution
   thing — it happened mid-session this time (PR #365 after #364 merged), with no close-out in
   progress. The note's scope is now stated generally.

**Next milestone/feature not yet identified for a future session** — M5 has 5 more unstarted
features (FEAT-019 Levey-Jennings/Westgard engine, FEAT-020 QC gating of result release, FEAT-022
worklist v2, FEAT-023 Haematology CBC + differential, FEAT-024 peripheral film structured reporting,
FEAT-025 delta checks — FEAT-024 still blocked on FEAT-023, FEAT-020 still blocked on FEAT-019). A
future `/orient` should run real milestone/next-task discovery fresh, weighing all of these against
current signals, not assume FEAT-019 is automatically next just because it continues the QC thread
FEAT-018/021 both touched.

**One item outside this session's own automated verification:** the staging outage-and-fix was
confirmed via CI's own smoke tests (api `/health`, web+Keycloak over real HTTPS) — a real human
login/usage check against the actual public staging URL was not performed (no tailnet access or
staging credentials available from this environment) and is worth a quick look next time a human is
at a computer, not because anything indicates a problem.
