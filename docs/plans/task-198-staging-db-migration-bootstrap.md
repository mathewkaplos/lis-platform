# Implementation Proposal: Staging DB migration bootstrap + lis_app password wiring
Status: APPROVED
ADR: none (no existing ADR covers staging DB provisioning)    Date: 2026-07-31    Backlog ID: #198

## 1. Goal
Fix the gap in #198: `deploy-staging.yml` never runs migrations and never sets
`lis_app`'s database password, so the API's `APP_DATABASE_URL` has always
resolved to an empty password against a schema that has never been created.
Confirmed directly on the droplet: `\dt` → "Did not find any relations",
`\du` → only the `postgres` role exists. Staging's DB has never been touched
by a migration, ever.

Two parts:
1. A one-time bootstrap of the already-running staging Postgres (apply all
   11 existing migrations, set `lis_app`'s password, set the missing
   `LIS_APP_DB_PASSWORD` secret).
2. A permanent fix to `deploy-staging.yml` so every future deploy applies new
   migrations automatically (idempotent — Drizzle tracks applied migrations),
   instead of this silently regressing again on the next schema change.

## 2. Affected files
- `.github/workflows/deploy-staging.yml` — add a "Build and push migrator"
  step (build-and-push job); restructure the deploy job to bring up
  `postgres`/`valkey`/`keycloak` first, wait for Postgres readiness, run the
  migrator + `ALTER ROLE`, then bring up `api`/`web` (so the API never starts
  against a not-yet-migrated schema).
- `infra/docker-compose.staging.yml` — pin the compose network name (`name:
  lis_staging_net` under a top-level `networks:` block) so `docker run
  --network` can target it deterministically instead of guessing Compose's
  auto-generated project-based network name.
- GitHub secret `LIS_APP_DB_PASSWORD` — currently missing entirely; generate
  and set it, same pattern as the `KEYCLOAK_ADMIN_PASSWORD` fix for #189.
- No changes to `apps/api/Dockerfile`: its existing `base` build stage
  already runs `pnpm install` (full devDependencies, including `tsx` and
  `drizzle-kit`) and `pnpm --filter @lis/db build` before the prod-only
  `deploy --prod` step that produces the slim runtime image. That `base`
  stage, built with `--target base` and pushed as its own tag, is a
  ready-made migrator image — no new Dockerfile needed.

## 3. Architecture consulted
- `db/migrations/0002_app_role.sql` header comment (RLS is a no-op for
  superusers/table owners — `lis_app` must be the API's real connection role).
- `scripts/db-reset.sh` (local) and `.github/workflows/pr.yml` lines 70–72
  (CI) — both existing, working precedents for "migrate, then `ALTER ROLE
  lis_app WITH PASSWORD ...`" as two explicit, ordered steps.
- Constitution Law #4 (structural RLS via PostgreSQL role, not app-level
  checks) — this proposal is what makes Law #4 actually true on staging for
  the first time.
- `~/work/lis-engineering/postmortems/2026-07-29-task-010-sentry-verification.md`
  and issue #138 — precedent for the "secret referenced but never set"
  failure class this also belongs to.

## 4. Skills loaded
None specific to this change; following AGENTS.md Rule #0 directly (this
document is that requirement).

## 5. Assumptions & autonomous decisions
- Migrations are additive/forward-only and safe to run against a truly empty
  schema (confirmed empty via `\dt`) — no existing data at risk for this
  first run.
- Reusing the existing Dockerfile's `base` stage as the migrator image
  (rather than writing a new Dockerfile) is the simplest option and touches
  the least surface area.
- `docker compose exec -T postgres psql ...` (already proven working in this
  file's own pattern for other `docker compose exec` style steps) is
  sufficient for the `ALTER ROLE` step — no new tooling needed there.

## 6. Risks
- **First-ever schema creation against a real remote environment.** Low risk
  in itself (target is confirmed empty), but it is the first time this
  pipeline will have ever done this — if something is wrong in migration
  0000–0011 that only surfaces against a fresh Postgres 16 instance (vs. the
  ephemeral containers used in CI/local), it will surface here first.
- **New image to build/push/maintain** (`lis-platform-migrator`) adds ~1–2 min
  to the build-and-push job and a second image in ghcr to track.
- **Ordering change in the deploy job** (splitting `docker compose up -d`
  into two stages) is a real behavior change to a pipeline that currently
  works end-to-end (post-#189, post-#199) — needs care to not reintroduce a
  #197/#199-style timing regression.
- **Going forward, CI gains the ability to run arbitrary migrations against
  a live environment on every push to `main`.** This is the correct long-term
  fix (matches CI/local precedent) but is a real increase in what an
  automated pipeline can do to a shared environment, worth naming explicitly
  rather than treating as free.
- Out of scope, explicitly not decided here: whether to also seed
  `db/seed/chemistry-catalog.sql` on staging. It's labeled a "placeholder
  standard panel" (fake data) in its own header, but the API likely can't do
  much meaningfully demoable without *some* catalog data, and FEAT-009 (#18)
  is blocked specifically on "feature demoed on staging." Flagging as a
  question rather than assuming either way (see §10).

## 7. Acceptance criteria
- `\dt` on the staging droplet shows all tables from migrations 0000–0011.
- `\du` shows `lis_app` with a real password (not empty).
- The API container's `/health` still returns `ok` post-change (regression
  check on #189/#199's fix).
- A DB-touching API request (any authenticated read) succeeds against
  staging instead of failing at the connection/auth layer.
- The next normal push-to-main deploy run applies zero new migrations (all
  already applied) and stays green — proves idempotency.

## 8. Testing plan
- Dispatch `deploy-staging.yml` manually (`workflow_dispatch`) first, watch
  the run, and have the human re-check `\dt`/`\du` on the droplet directly
  before treating this as done (same verify-by-console pattern used for
  #189, not just "the pipeline said success").
- Manually hit one real DB-touching API endpoint from the droplet (e.g. via
  `curl` to an authenticated route, or a direct `psql` query as `lis_app`
  with the new password) to prove the connection actually authenticates and
  RLS behaves, not just that tables exist.

## 9. Rollback plan
- Schema: migrations are additive-only; nothing here drops or alters
  existing data (there is none yet), so there is no meaningful "rollback" of
  the schema itself — worst case is re-running is a no-op.
- Pipeline: the workflow/compose changes are revertable by reverting the PR;
  no destructive step is added (no `docker compose down -v`, no data deletion).
- Secret: if `LIS_APP_DB_PASSWORD` needs to change later, re-run `ALTER ROLE`
  with the new value and update the secret — same process as first-time setup.

## 10. Questions requiring human approval — ANSWERED 2026-07-31
1. **Migrator execution mechanism** — APPROVED: migrator image via
   `docker run` (reuse Dockerfile's `base` stage, invoke over SSH).
2. **Deploy job reordering** — APPROVED: split `up -d` so api/web only start
   after migrate + ALTER ROLE succeed.
3. **Run on every deploy, or one-time only?** — APPROVED: every deploy
   (idempotent).
4. **Seed data** — APPROVED: also seed `db/seed/chemistry-catalog.sql` on
   staging.
5. **Timing of the one-time bootstrap dispatch** — deferred until the PR is
   up; will ask explicitly before dispatching against the live droplet
   (same pattern as #189).
