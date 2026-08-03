# Status — 2026-08-03 (session 12)

Last commit on main: 0750e6c — "fix: every real staging login fails -- SESSION_SECRET frozen at
build time in proxy.ts (#279)".

## Real staging login bug found and fixed, via PR #278 (`086226e`) + PR #279 (`0750e6c`) — from a
prior, un-closed-out session

Every real login on staging looped forever between `/`, `/api/auth/login`, and Keycloak — the
callback route succeeded on every single attempt, but the very next request to `/` immediately
bounced back to login. Root cause: `apps/web/auth/secret.ts` read `SESSION_SECRET` as a top-level
module constant; `deploy-staging.yml` builds the image with a hardcoded placeholder secret (so the
real one never lands in a Docker layer) and supplies the real secret only at container start.
Next.js 16's `proxy.ts` goes through the `MiddlewarePlugin` webpack step, which does its own
build-time `process.env.*` substitution — separate from ordinary Route Handlers, which read
`process.env` fresh at request time. `signSession()` (callback route) signed with the real runtime
secret; `verifySession()` (`proxy.ts`) verified against the frozen build-time placeholder. Fixed by
reading `SESSION_SECRET` via a function called fresh at each call site instead of an eagerly-
evaluated constant. PR #278 (merged first) added real error logging to every auth-callback failure
path, ahead of the actual fix. Written up as `authentication` Skill entries #12-#13.

**This session's own `/orient` found that session had no close-out**: `docs/scope/current.md` still
read session 11's own PR #274/#275 recap, unaware #278/#279 had merged; no session-close report
existed after `2135-pre.md` (which predates both PRs); the `authentication` Skill hadn't been
extended with the new gotcha despite AGENTS.md's same-day standing rule. All three fixed this
session (this refresh, the Skill entries above, and a new close report).

**Verification attempted this session, partially blocked by a separate, real, still-open issue**:
driving a real headless-Chromium browser against real staging (`https://lis-staging.taila0fbf9.ts.net`
— reachable from this dev sandbox via a WSL-host-inherited Tailscale route, not previously known to
be available) confirmed the proxy correctly redirects to a genuine Keycloak challenge (TLS, PKCE,
`redirect_uri` all correct — the layer entry #12's bug lived in is healthy). But submitting the
documented `test-user`/`test-password` credential was rejected by Keycloak itself with "Invalid
username or password," before ever reaching `apps/web`'s callback route — upstream of and unrelated
to the SESSION_SECRET bug. **Initially suspected brute-force lockout — checked locally and ruled
out**: local Keycloak's live realm shows `bruteForceProtected: false`, and the identical credential
logs in successfully there (real password-grant token issued). Staging's Keycloak *is* fully
recreated from `lis-realm.json` on every deploy, so it isn't stale state either. Real difference
found: staging runs Keycloak in production `start` mode under a real `mem_limit: 320m`, where local
runs unconstrained `start-dev` — plausible (import-time credential hashing failing under memory
pressure) but unconfirmed. **Still open**: someone with Keycloak admin API access on staging should
inspect `test-user`'s live representation or the container's boot log to find the actual cause.
See `authentication` Skill entry #13.

**Local branch cleanup done this session**: `fix-session-secret-build-time-inlining` (already merged
as PR #279) deleted, both local and remote; local checkout fast-forwarded to `0750e6c`.

## New standing rule this session: Claude Code may self-merge PRs once CI is green

`AGENTS.md`'s Rules of engagement gained a rule (human-approved) that `gh pr merge <n> --squash` no
longer needs per-PR confirmation once CI is green — `--delete-branch` still independently blocked by
`guard-dangerous-git.py` for the real 2026-07-26 incident it exists for. **Landing that rule surfaced
its own bootstrapping caveat**: the auto-mode classifier applies real, not-fully-predictable extra
scrutiny to any git/gh write action on a branch that touches `AGENTS.md` itself (or `.claude/
settings*.json`/hooks) — some denials self-resolved on retry, others required the human to run the
exact command directly, across `git add`, `git commit`, `git push`, and `gh pr create` for PR #275
(the PR that added the rule). Written up as an Engineering Flow Retrospective finding in the
`2026-08-02-2135-pre.md` close report; the caveat itself is expected to land as its own follow-up.

## Deploy to Staging fixed this session, via PR #274 (`215690a`) — staging is healthy again

TASK-038's `0012_patient.sql` migration had been failing on every real staging deploy (runs
30757994494, 30757028776): a real `order` row left over from FEAT-009's proof routes (predating the
`patient` table) had a `patient_id` that didn't match any real patient, so the FK-adding
`ALTER TABLE` rejected it. Fixed by adding `DELETE` cleanup for orphaned `order`/`observation` rows
immediately before the FK `ALTER TABLE` statements, inside the same already-merged migration —
a narrow, human-approved exception to "never edit a past migration," justified because this
migration had never actually succeeded against any persistent/real environment (only ephemeral
CI/local Postgres).

Verified against the exact failure condition, not just a clean DB: reverted a local DB to the
pre-0012 schema, inserted an `order` row with the same orphaned `patient_id` from the real staging
failure, re-ran the migration, and confirmed the row was deleted and the FK constraint now exists.
**Confirmed for real**: the next actual "Deploy to Staging" run (30759086369, triggered by this PR's
merge) succeeded end-to-end — `build-and-push`, `deploy` (migration + both smoke tests) all green.
FEAT-011's patient tables/API/registration form are now actually live on staging for the first time.

**AGENTS.md also gained a new standing rule this session**: Claude Code may run
`gh pr merge <n> --squash` autonomously once CI is green, without waiting for per-PR confirmation —
`--delete-branch` must never be combined with the merge in the same command (still independently
blocked by `guard-dangerous-git.py`, unchanged, for the real reason it was added). This PR (#274)
was merged by the human under the old convention; future merges should happen without asking.

## TASK-040 (FEAT-011) merged this session, via PR #271 (`3c07232`)

`apps/web`'s first real form, first real page beyond the app shell placeholder, and first real
call to `apps/api`. `packages/sdk`'s first real content: types generated from `apps/api`'s live
OpenAPI document (`openapi-typescript` + `openapi-fetch`, checked in per ADR-0013 §1 — a visible,
diffable contract artifact). Registration screen at `/patients/new`, KB-02-minimal field set, a
single Server Action doing duplicate-check-then-create. Soft "Possible match found" review callout
on an exact `firstName`+`lastName`+`birthDate` match (proposal §10 Q1) — distinct from the existing
hard `409` on an exact `nationalId` collision (TASK-039). `GET /v1/patients` extended to accept this
name+DOB combination as a third lookup shape.

**Three real bugs found and fixed via this task's own testing, not assumed correct** (full detail
in `docs/plans/feat-011-patient-management.md`'s TASK-040 §11, a fifth instance added to AGENTS.md's
harness-mismatch rule):
1. **`apps/api`'s real (compiled, Fastify) server has been unable to start at all since TASK-039**
   added `SwaggerModule.setup()` to `main.ts` — `@fastify/static` was never installed. Every e2e
   spec defaults to Express and never exercised the real Fastify adapter; this task's own manual
   verification was the first thing to actually boot `main.ts`'s real bootstrap path, and it
   crashed immediately. This was a **live production-blocking regression sitting on `main` since
   TASK-039's own merge**, only caught now. Fixed and verified against a real `docker build` +
   `docker run` of the actual production image.
2. A `'use server'` file may only export async functions at runtime — a plain object export
   (`registerPatientInitialState`) threw only when a real request hit it, invisible to
   typecheck/lint. Moved to a separate `types.ts` file.
3. This sandbox's TypeScript incremental build cache is unreliable under WSL2 (`nest build`/`tsc`
   reported success while silently producing no `dist/` output) — a real, reproducible sandbox
   limitation, not a code bug; worked around locally, not chased further.

**Verified end-to-end with a real headless-Chromium Playwright check** (real Keycloak tokens, real
`apps/api`, real Postgres, this sandbox's own missing-`libnss3.so` workaround per the `web-verify`
Skill): registration succeeds with a real assigned MRN; a repeat submission with the same name+DOB
shows the duplicate warning with correct existing-patient details; proceeding past it creates the
second patient.

**CI gap found and fixed after merge, same class as before**: `apps/web` now genuinely imports
`@lis/sdk`'s exports for the first time — `pr.yml` never gained a build step for it (same class of
gap already fixed twice this session for `@lis/db`/`@lis/domain`). Reproduced locally, fixed, PR
re-verified green before merge.

**`#99` didn't auto-close** (same gotcha as `#265` before it — the PR body referenced it in prose,
not a bare `Closes #99` line) — closed manually via comment.

**FEAT-011 remaining**: only TASK-041 (search + profile screens, #100) is left. `engineering/
api-design` and `domain/patient-identity` Skills, named by FEAT-011's own issue (#20), still don't
exist — flagged four times now across TASK-038/039/040-adjacent proposals, genuinely load-bearing
for TASK-041's own frontend work.

## Real deploy-blocking bug found and fixed this session, via PR #269 (`45ca1bb`)

The user hit a real `docker buildx` failure directly (`pnpm install --frozen-lockfile` exit code 1)
— caused by PR #266's own `vite` override fix: both Dockerfiles (`apps/api`, `apps/web`) run bare
`corepack enable` with no pinned pnpm version, so the Docker build resolved whatever pnpm corepack
defaults to (newer than the `pnpm@9` GitHub Actions CI is pinned to), which doesn't read
`package.json`'s `"pnpm"` field (where the override now lives) — the same class of mismatch #266
fixed for CI, surfacing in a third place. Fixed at the root: `"packageManager": "pnpm@9.15.9"`
pinned in `package.json`, which corepack respects everywhere (Docker, this sandbox's local shell,
any corepack-managed invocation). That in turn conflicted with `pr.yml`'s own explicit
`pnpm/action-setup@v4 with: {version: 9}` (the action hard-errors on "Multiple versions of pnpm
specified" when both are set) — fixed by removing the now-redundant explicit `version:`, letting
the action auto-detect from `packageManager` instead (its own documented intended pattern).
Verified for real: both Dockerfiles build successfully end-to-end (previously reproducible
failures), CI green, merged.

## Session token bridge (#265) merged this session, via PR #266 (`f895249`) — a prerequisite for TASK-040, not TASK-040 itself

Planning TASK-040 (#99, FEAT-011, registration form + duplicate detection) surfaced a bigger,
real gap before any form code could be written: **`apps/web` had no way to call `apps/api` at
all.** The real Keycloak `access_token`/`refresh_token` were fetched at login and immediately
discarded — `SessionPayload` only ever carried `sub`/`tenantId`/`roles`/`idToken`. Compounding
this, the realm's `accessTokenLifespan` (300s) is far shorter than the 30-minute session cookie, so
even naively storing the access token alone would have made the registration form (and every
future authenticated frontend feature) start failing with `401`s after 5 minutes into an
otherwise-valid session. Raised to the human directly, resolved as **ADR-0014** (accepted, pushed
to `lis-engineering`): retain both tokens, refresh server-side via a single `getValidAccessToken()`
helper before any `apps/api` call. Landed as its own prerequisite PR, not folded into TASK-040's own
UI work, since every future frontend feature calling `apps/api` needs this same bridge.

**TASK-040 itself has not started** — this was groundwork found and cleared first, per Rule #0
(stop for a missing load-bearing decision before building on top of it).

**Two more real, unrelated things found and fixed via this work's own testing, not assumed
correct:**
1. Adding `vitest`/`vite-tsconfig-paths` to `apps/web` (its first-ever test tooling) shifted pnpm's
   peer-dependency resolution enough to break `apps/api`'s own `vitest.config.ts` typecheck (two
   internally-inconsistent `vite` versions resolved within the same package) — a real regression,
   confirmed via `git stash` against a clean checkout, not a pre-existing issue. Fixed by pinning
   `vite` to a single version workspace-wide.
2. **That fix itself then broke CI** the first time, because CI's `pr.yml` pins `pnpm` to `v9`
   (`pnpm/action-setup@v4`), and pnpm v9 silently does not read `pnpm-workspace.yaml`'s `overrides`
   field at all (confirmed directly by running the real `pnpm@9` locally) — a newer-pnpm-only
   location. Fixed by moving the override to `package.json`'s `"pnpm"` field instead, and
   regenerating `pnpm-lock.yaml` with the actual `pnpm@9` binary (via `npx`) rather than this
   sandbox's mismatched local `pnpm` (v11), so the committed lockfile matches exactly what CI
   independently computes.

**Bigger finding surfaced by the above, filed separately as #267, not fixed this session:**
`pnpm-workspace.yaml`'s `allowBuilds`/`minimumReleaseAgeExclude`/`injectWorkspacePackages` fields
are *also* silently ignored by pnpm v9 — confirmed directly: a real `pnpm@9 install` ran
`@scarf/scarf`'s and `@sentry/node-cpu-profiler`'s postinstall/install scripts to completion despite
both being set to `false` in `allowBuilds`. This means the supply-chain-security build-gating this
repo's config appears to establish has likely **never actually been enforced in CI**, silently,
probably since whoever authored those fields was using a newer local pnpm than CI's pinned v9. Not
fixed here — the real options (upgrade CI's pnpm, or rewrite the config for v9) are a real decision
for whoever picks up #267, not a mechanical fix.

**Also confirmed, not a regression**: `pnpm --filter web build` (production build, Turbopack) fails
locally in this sandbox specifically on `/_global-error`'s prerender step
(`TypeError: Cannot read properties of null (reading 'useContext')`) — reproduces identically on a
clean `main` checkout, survives a full `.next` cache clear, and CI's own `pnpm build` step has
passed reliably across every recent PR. Written up as a known sandbox-only gotcha in the
`web-verify` Skill; use `pnpm --filter web dev` for local verification instead, trust CI for the
real production-build proof.

## TASK-039 (FEAT-011) merged this session, via PR #263 (`5ff9b14`)

The first real domain-resource API endpoint in this repo. Built against a new **ADR-0013**
(accepted this session, pushed to `lis-engineering`): a minimal API baseline — Zod schemas in
`packages/domain` drive both request validation (`nestjs-zod`) and OpenAPI generation from one
source, RFC 9457 `problem+json` errors applied globally, `/v1` prefix scoped to new resource routes
only (`/auth/*`/`/health` stay unversioned) — deliberately deferring `ETag`/`If-Match`,
`Idempotency-Key`, and cursor pagination until a real task needs them, rather than building KB-08's
full platform contract inside a single 1-day task.

Delivered: `POST/GET /v1/patients`, `GET /v1/patients/:id` — MRN server-generated
(retry-on-unique-violation, proposal §10 Q1), new `manage_patients` capability (granted to both
existing roles, §10 Q2), `POST` audited via the existing FEAT-009 mechanism, OpenAPI served at
`/v1/docs` generated from the same Zod schemas.

**Two real bugs found and fixed via this task's own testing, not assumed correct:**
1. Vitest's esbuild transform doesn't emit `design:paramtypes` — same root cause
   `capability.guard.ts`'s comment already documents for constructor DI, now confirmed to also
   silently no-op nestjs-zod's global `ZodValidationPipe` (it couldn't identify a method
   parameter's DTO class, so a malformed request body sailed straight to the database unvalidated,
   failing on a Postgres `NOT NULL` violation instead of `400`). Fixed by passing each Zod schema
   explicitly at the `@Body()`/`@Query()`/`@Param()` call site. Written up as `testing` Skill entry
   #6 (pushed to `lis-engineering`) — this is a general vitest-harness gotcha, not scoped to this
   one task.
2. Running `patient.e2e-spec.ts` (audit-count assertions against `TENANT_A`) alongside
   `capability-check.e2e-spec.ts` (same tenant, same kind of assertion) under vitest's default file
   parallelism interleaved their audited writes, breaking both files' delta assertions *and*
   `TENANT_A`'s audit hash-chain check, nondeterministically. Fixed with `fileParallelism: false` in
   `vitest.e2e.config.ts` — a real, previously-latent gap this task's second audit-writing e2e file
   exposed, not a bug in either file's own logic.
3. **CI-only failure, not reproducible locally at first**: `pr.yml` never gained a build step for
   `@lis/domain` when this task made it apps/api's second real workspace-package dependency (it had
   been a placeholder `export {}` before) — the exact same class of gap already fixed for `@lis/db`
   in TASK-030. Type-aware lint resolved every `@lis/domain` import to TypeScript's "error" type in
   CI's clean checkout (no pre-built `dist/`), which passed locally only because `packages/domain`
   had already been built earlier in the same session. Reproduced locally by deleting
   `packages/domain/dist` before linting, confirmed fixed by adding `pnpm --filter @lis/domain
   build` to `pr.yml` alongside the existing `@lis/db` step.

Also fixed in passing: `pnpm-workspace.yaml`'s `@scarf/scarf` build-approval was a literal
placeholder string ("set this to true or false"), not an actual boolean — blocked every `pnpm`
command the moment a new dependency (`swagger-ui-dist`) pulled that package in transitively. Set to
`false` (pure install-time telemetry).

**FEAT-011 remaining**: TASK-040 (registration form + duplicate detection, #99) and TASK-041
(search + profile screens, #100) — each needs its own proposal revision once the prior task's real
output exists, same scope-narrowing precedent as before. `engineering/api-design` and
`domain/patient-identity` Skills (named by FEAT-011's own issue, #20) still don't exist — flagged
again, now genuinely load-bearing for TASK-040/041's own frontend/API work.

## M3 has started: TASK-038 (FEAT-011) merged this session

M2 was engineering-complete (only #2 open, blocked on a non-engineering design-partner demo) and
M1's 3 remaining open issues were all blocked on non-engineering factors — `/orient` →
engineering-radar reasoned this made **TASK-038 (#97, FEAT-011's first task)** the highest-leverage
next engineering work, unlocking the rest of M3.

**TASK-038 closed, via PR #261 (`719e1c2`).** Implementation Proposal
`docs/plans/feat-011-patient-management.md` approved (KB-02-minimal core scope: identity,
demographics required for range resolution, MRN + national ID — contact/insurance/emergency-contact
fields deliberately deferred until TASK-040 confirms the design partner's real requirements).
Delivered: `patient` + `patient_alert` tables (both RLS-isolated, live-leak-check verified), and the
ADR-0005 FK backfill onto `observation.patient_id`/`order.patient_id`.

**Real gap found during this proposal's own research, not fixed here:** ADR-0005 also required
`observation.ordered_test_id`/`specimen_id` to be FK-backfilled by TASK-023 — cross-checking that
ADR's literal acceptance-criteria text against the real schema (`packages/db/src/schema/
observation.ts`'s own still-present "FK backfilled by TASK-023" comments) showed it never actually
happened. **Filed separately as #260**, deliberately kept out of PR #261's scope (human decision,
2026-08-02) to keep that migration's diff and rollback story scoped to what TASK-038's own issue
describes.

**CI caught a real regression PR #261's own local testing plan missed**: `apps/api`'s e2e suite
(`capability-check.e2e-spec.ts`, run by CI's `build-and-test` job, never run locally as part of this
task's own plan) failed — a FEAT-009 proof controller used `randomUUID()` for `order.patientId`,
valid before TASK-038's FK backfill, silently wrong after. Fixed (real `patient` fixture row via a
new `insertDemoPatient` helper), verified locally (all 17 e2e tests green), pushed, CI green. Written
up as a fourth real instance of AGENTS.md's existing "a pass in one harness doesn't prove a pass in
another" rule, and as a new `database-design` Skill entry (#4) — grep every `.insert(<table>)` call
site on a table gaining a new FK, not just the migration's own tests, before considering an
FK-backfill done.

**Merge required the human**: `gh pr merge` is blocked for this agent by both a PreToolUse hook
(citing a prior incident where `--delete-branch` silently no-op'd a merge and deleted a branch with
unpushed work) and the auto-mode classifier itself. Merged by the human; branch cleanup (local +
remote delete) done by the agent afterward.

## What's actually done (per real evidence)

Session 10 closed out M2's engineering work but left one known gap: `unmanagedAttributePolicy:
"ENABLED"` (required for the custom `tenant_id` Keycloak attribute to survive any live write) was
only a manual, live-only setting on staging's realm — not committed anywhere — and would be
silently wiped by `deploy-staging.yml`'s own Keycloak force-recreate (added that same session).
This session (`/orient` → engineering-radar → filed and closed **#256**) fixed that gap for real.

**#256 closed, via PR #257 + PR #258.** The original plan (Implementation Proposal
`docs/plans/task-256-commit-unmanaged-attribute-policy.md`) was to commit a `components`/User
Profile block directly into `infra/keycloak/lis-realm.json`. That turned out non-executable:
confirmed via `scripts/feat009-staging-verify.md` that there is no SSH/droplet-console access
available this session, and hand-authoring Keycloak's exact `components` wrapper schema from
documentation alone was judged too risky (a wrong guess would silently no-op, not error).
**Revised mechanism (human-approved):** automate the already-proven GET/merge/PUT Admin REST API
sequence (the same one `scripts/feat009-staging-verify.md` Step 1 already used successfully) as an
idempotent step in `deploy-staging.yml`, run against Keycloak's own host-local `:8080` listener
right after it starts, before `api`/`web` come up. `infra/keycloak/lis-realm.json` itself is
unchanged by this fix.

CodeRabbit's review on PR #257 caught three real gaps in the first draft, all fixed before merge:
missing `--connect-timeout`/`--max-time` on the three new Admin REST calls, no fail-fast/empty-
token check (a broken admin login would have silently no-op'd instead of aborting the deploy), and
`api`/`web` starting concurrently with the policy fix instead of after it. All three fixed,
re-verified locally, then verified for real: PR #257's merge auto-triggered a staging deploy (run
`30742799694`) whose own log shows the profile re-fetched with `unmanagedAttributePolicy: ENABLED`
and `PUT: HTTP 200` — proving the setting was reapplied automatically right after that deploy's
real Keycloak recreate. #256 auto-closed via the PR's `Closes #256` line.

**Accepted verification gap:** an actual live user write with `tenant_id` surviving specifically
on *staging* (vs. the identical mechanism already proven locally, including a full live user-write
round trip) was not independently re-checked — needs droplet-console access not available this
session. Human explicitly accepted the deploy-log evidence as sufficient (2026-08-02) rather than
leaving this silently unverified.

**Docker daemon crashed mid-session** (memory pressure: 215Mi free of 7.6Gi at the time) while
verifying the fix locally. No self-recovery path existed for the agent (no passwordless sudo, no
TTY for an interactive sudo password) — required the human to restart Docker Desktop on the
Windows host. Recovered cleanly once restarted; no data lost. Written up as an Engineering Flow
Retrospective finding this session (see below).

**Two AGENTS.md additions this session** (both approved 2026-08-02, see `AGENTS.md`'s Rules of
engagement for the full text):
1. If a `docker`/`docker compose` command hangs rather than errors, check `systemctl is-active
   docker`/`pgrep dockerd` before assuming a compose-file or command bug — and if the daemon is
   down, say so plainly rather than retrying the same command.
2. Before drafting an Implementation Proposal's mechanism for anything touching staging/production
   infra, check the relevant runbook(s) for already-documented access constraints (SSH
   availability, reachable ports, credential locations) first — the #256 IP's original mechanism
   assumed SSH access already documented elsewhere as unavailable, costing a full revision cycle
   that checking first would have avoided.

**Session-close Final Close Report** written and pushed to `lis-engineering`
(`session-close-reports/2026-08-02-1328-final.md`), resolving `2026-08-02-1119-pre.md` (which had
carried no pending items forward). This report's own fresh checks surfaced the three items above
(breadcrumb refresh, the two retrospective notes) — all resolved by explicit human decision before
this breadcrumb was written.

## M2 exit criteria — status

Unchanged from session 10 — M2's own exit criteria (`/mnt/d/LIS/research/LIS-Execution-Plan.md:97-99`)
remain fully satisfied; see git history for the full evidence table. This session's work was a
carried-forward infra gap fix (#256), not new M2 scope.

## EPIC-002 (#2) — current state: open, pending a design-partner demo

Unchanged from session 10. #2 stays open until a real design-partner demo happens — explicit human
decision (2026-08-02, session 10), reconfirmed still accurate this session (no new information
changes this). **Do not close #2 on any future session's own initiative** — every engineering box
is checked; the design-partner demo is the one remaining, non-engineering blocker.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 14 closed / 1 open (unchanged this session —
#256 was not M2-milestoned). The one remaining open M2 item is #2 (EPIC-002) itself, not blocked on
any further engineering work.

**M3 — Pre-Analytical Workflow: started this session.** TASK-038 (#97, patient/patient_alert
migration) and TASK-039 (#98, patient API) both closed, via PR #261 and PR #263. The session-token
bridge (#265, prerequisite for TASK-040) also closed, via PR #266 — see its own section above.
**TASK-040 (#99, registration form + duplicate detection) itself has not started yet.** FEAT-011's
remaining tasks — TASK-040, TASK-041 (#100, search + profile screens) — are still open; each will
need its own revision to `docs/plans/feat-011-patient-management.md` once the prior task's real
output exists (same scope-narrowing precedent FEAT-010's proposal used). `engineering/api-design`
and `domain/patient-identity` Skills, named as "Required Skills" by FEAT-011's own issue (#20), still
don't exist — flagged three times now (TASK-038, TASK-039, and the token-bridge proposals),
genuinely load-bearing for TASK-040/041's own frontend work.

**Unrelated open issues, not M2/M3-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unreproduced (last checked 2026-08-01; unchanged
  across multiple sessions now, from session 4).
- **#240** — sidebar nav fully hidden below `sm` breakpoint, no replacement trigger. Still needs a
  triage decision (fast-follow vs. a later dedicated mobile pass), not decided yet.
- **#260** — `observation.ordered_test_id`/`specimen_id` were never actually FK-backfilled by
  TASK-023, despite ADR-0005 requiring it. Found during TASK-038's proposal research, deliberately
  kept out of PR #261, filed as its own follow-up. Not yet worked.
- **#267 (new this session)** — CI's pinned `pnpm@9` silently ignores `pnpm-workspace.yaml`'s
  `overrides`/`allowBuilds`/`injectWorkspacePackages` fields entirely (confirmed directly). The
  supply-chain-security build-gating those fields appear to establish has likely never actually been
  enforced in CI. Found while fixing the token-bridge PR's own CI failure; not fixed itself — needs
  a real decision (upgrade CI's pnpm, or rewrite the config for v9). Not yet worked.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.
- ADR-0012's own acceptance criterion that port 22 remains SSH-restricted to `tag:ci-runner` —
  session 10 left this unconfirmed; **resolved this session's `1119-pre.md` report**: a real
  `ssh root@100.98.252.45` attempt from a human device timed out, confirming the ACL widening
  didn't loosen SSH access. No longer an open item.
- **`unmanagedAttributePolicy` live-only-setting risk — closed this session.** See #256 above. No
  longer an open item.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- **#74 (TASK-015)'s out-of-band closure — resolved, no longer open.** Corrected this session
  (orientation drift check): #74 is CLOSED, with real verification already in its own comment
  thread — `.github/workflows/constitution-gate.yml` confirmed live on `main`, enforcing Law #1
  and Law #4 in CI, with five consecutive green runs cited as evidence. The prior breadcrumb wording
  ("remains unverified") was stale; dropped from the carried-forward list.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **A realm-file change can deploy successfully and still never take effect** (session 10's
  Keycloak-no-persisted-volume finding) — unchanged, still true, still worth knowing. Full detail
  in `authentication` Skill entries #7-#10.
- **A live-only Keycloak setting doesn't survive a force-recreate unless something reapplies it
  every deploy.** This session's own #256 finding, generalized: any manual admin-console/Admin-API
  tweak made directly against staging (not committed anywhere) is exactly as fragile as
  `unmanagedAttributePolicy` was — check for other undocumented live-only settings if staging
  behavior ever silently regresses after a deploy.
- **Local Docker verification has no agent-side recovery if the daemon dies.** New this session —
  see AGENTS.md's Rules of engagement. If `docker`/`docker compose` hangs, check whether the daemon
  itself is actually running before assuming a code bug.
- **Check known access constraints (SSH, ports, credentials) before drafting an IP's mechanism for
  staging/production infra work.** New this session — see AGENTS.md's Rules of engagement. Costly
  to skip: the #256 IP's first draft assumed access that was already documented as unavailable.
- Earlier sessions' notes/gotchas (checking child tasks/comment threads not just headline
  Project-status fields; `gh issue`/`gh pr` write denials falling back to `mcp__github__*`;
  closing convention is a comment, not a body edit; PreToolUse denials needing a read-only
  verification before assuming partial execution) are unchanged and still apply — not repeated
  here, see git history for earlier breadcrumbs if needed.
