# Status — 2026-08-05 (session 14)

Last commit on main: `3b82056` — "docs: TASK-045 close-out -- plan doc status updated with merge
SHA" (PR #298).

## TASK-045 (FEAT-013's first task) merged this session, via PR #297 (`792e373`) — EPIC-003's third
feature has started

`/orient` re-ran milestone discovery from scratch per session 13's own instruction rather than
assuming FEAT-013 was automatically next — all three signals (GitHub Milestones, breadcrumb,
FEAT-013's own issue #22) agreed cleanly. FEAT-013 (#22) names four tasks; TASK-045 (#104,
accession-number generation) is the only one with no unmet dependency (TASK-042, already merged).
Implementation Proposal `docs/plans/feat-013-accessioning-labels-reception.md` drafted and approved
2026-08-05, deliberately scoped to TASK-045 only — same narrowing precedent as every prior feature
in this repo (FEAT-010/011/012). TASK-046/047/048 remain open, to be specified as revisions to the
same file once their own real output exists.

**Real, load-bearing finding from the proposal's own research, not present in TASK-045's issue
text:** `packages/db/src/schema/specimen.ts` already existed (TASK-023/FEAT-006,
`0009_order_specimen.sql`) with `accessionNumber: text NOT NULL` and a per-tenant unique index — but
no code anywhere had ever inserted into `specimen`, the same "table exists, unused" pattern already
hit twice before (`order`/`ordered_test` before TASK-042, the catalog tables before TASK-043). Per
KB-03 ("Receive & Accession. Lab receipt confirms condition and assigns the accession identifier"),
the actual `specimen` row insert belongs to TASK-047 (reception), not TASK-045 — this task delivers
only the generation mechanism, consumed later.

**Two real, human-approved decisions, both resolved via the native options-prompt (proposal §10),
not silently assumed:**
1. **Generator mechanism: a Postgres `SEQUENCE` (`nextval()`), not the MRN's retry-on-unique-
   violation pattern (`engineering/api-design` entry #9).** A pre-existing code comment in
   `patient.controller.ts` (written during TASK-039, before FEAT-013 was ever scoped) had already
   anticipated this task by name and number, flagging retry-on-violation as insufficient for
   "concurrent analyzer writes." `nextval()` is lock-free and doesn't degrade under concurrent
   callers; proven directly, not just argued — 200 concurrent calls against real Postgres produced
   200 unique values (the literal AC). Reuses `audit_event.sequence`'s own already-shipped precedent
   (global sequence, not per-tenant — a global-unique value trivially satisfies per-tenant
   uniqueness) and its documented `GRANT USAGE, SELECT ON SEQUENCE` gotcha, applied proactively this
   time rather than rediscovered. Written up as a new `engineering/api-design` Skill entry #13.
2. **Format: `YYMMDD-NNNNNN`** (UTC date generated + 6-digit zero-padded global sequence, e.g.
   `260805-000123`) — no existing convention named one anywhere in this repo or the KB.

No controller, no domain Zod schema, no new capability — TASK-045 exposes no HTTP surface by design
(proposal §5); nothing to regenerate in `apps/api/openapi.json`/`packages/sdk/src/schema.ts`.

**One real gotcha caught during implementation, not part of the approved proposal's own text:**
`db.execute(sql\`...\`)` on the `node-postgres` driver returns the raw `pg` `QueryResult`
(`{ rows: [...] }`), not a bare destructurable array — the first call site in this repo to read a
scalar value back from `db.execute()` rather than discard it (every prior call site was a discarded
`SELECT set_config(...)`). Confirmed by reading `drizzle-orm`'s own `node-postgres/session.js`
source directly, not assumed. Missed in the same-day Skill write-up during implementation itself —
caught by `/close`'s own review of the session's work, not by a human catching it later. Written up
as `database-design` Skill entry #7.

Verified end-to-end against real Postgres: migration `0014_accession_sequence.sql` (hand-written,
per `database-design` entry #5's precedent for objects outside drizzle's schema vocabulary) applies
cleanly on top of the existing 13; a fresh `drizzle-kit generate` afterward confirms zero pending
diff; the `GRANT` independently re-verified by connecting as the real `lis_app` role (not the
migration/superuser role) and calling `nextval()` directly; the new e2e spec and the full existing
48-test `apps/api` suite both green; repo-wide `typecheck`/`lint` green. CI green on both PRs
(`#297` the implementation, `#298` the plan-doc close-out); the `Deploy to Staging` run #297's merge
auto-triggered completed successfully; #298 (docs-only) correctly did not trigger a second deploy
(`paths-ignore` working as intended).

**Also found this session, real Docker-availability friction, not a code bug:** `docker` was not
found in PATH at all at session start (WSL integration inactive) — a third, distinct flavor of
"Docker unavailable at session start" this project has now hit (session 10: daemon crashed under
memory pressure; session 12: WSL2 backend hung 10+ minutes with no daemon socket; this session:
`docker` absent entirely). Resolved by locating the real `Docker Desktop.exe` path directly
(`find`, since a first guessed path silently failed) and launching it from WSL, then polling
`docker info` until ready (~10s once launched). Written up as `engineering/docker-pnpm-monorepo-
deploy` Skill entry #23, approved and pushed via this session's own `/close` Pre-Close Report.

`#104` auto-closed via PR #297's bare `Closes #104` line — correct on the first try this time, no
repeat of the recurring PR-body-prose gotcha (`#99`/`#265`/`#74`/`#93`/`#94` before it).

**FEAT-013 remaining**: TASK-046 (label rendering, #105, depends on TASK-045 — now unblocked),
TASK-047 (reception screen, #106, depends on TASK-045 — now unblocked), TASK-048 (collection queue,
#107, depends on TASK-047). `engineering/barcode-printing` and `domain/specimen-lifecycle` Skills,
named as "Required Skills" by FEAT-013's own issue (#22), still don't exist — not drafted this
session since neither was load-bearing for TASK-045's own narrow scope (proposal §4); genuinely
needed once TASK-046/047 actually start. `/orient`'s next run should specify TASK-046 or TASK-047 as
a revision to `docs/plans/feat-013-accessioning-labels-reception.md`, not start a new proposal file.

---

# Status — 2026-08-04 (session 13)

Last commit on main: 2f567e3 — "fix(audit): hash undefined-valued keys the way jsonb storage
actually drops them", part of PR #294 (merged as `0aee3bc`).

## FEAT-012 (Order entry) fully closed this session — all three tasks merged, EPIC-003's second
feature done

TASK-042 (API: create/search/cancel, PR #290 `eb41052`), TASK-043 (order builder UI, PR #291
`43653ce`), TASK-044 (order list + detail screens, PR #294 `0aee3bc`) — all merged, all closed via
comment (`Closes #N` never auto-closed for any of the three, same recurring PR-body-prose gotcha as
`#99`/`#265`/`#74` before them). `docs/plans/feat-012-order-entry.md` marked `IMPLEMENTED` with all
three merge SHAs. FEAT-012 (#21) and TASK-044 (#103) closed via comment.

**Delivered**: `POST/GET /v1/orders`, `GET /v1/orders/:id`, `POST /v1/orders/:id/cancel` (this
repo's first action sub-resource), `GET /v1/catalog` (a real prerequisite gap found and filled
mid-feature — no endpoint had ever exposed the test/panel catalog). `apps/web` gained three new
screens: `/orders/new` (catalog picker, panel expansion, priority), `/orders` (global cross-patient
list, filters by status/priority/date range), `/orders/[id]` (detail + cancel action). Sidebar
gained "Orders". `order.priority` added to the schema (FEAT-006 had deliberately deferred it since
nothing consumed it yet — FEAT-012 is that first real consumer).

**Deliberately narrower than the Stitch mockups** (§6.1–6.3), same precedent as FEAT-011: no
ordering-doctor/ICD/insurance/pricing/TAT/discipline-grouping/accession-number/specimen-tracking/
billing/documents — none has supporting schema or API yet (TASK-045+/FEAT-013/014 own scope).
"Cancel order" on the detail screen is the one deliberate exception to strict AC-only scope,
justified because the API already fully supported it with zero UI surface anywhere until now.

**Four real bugs found and fixed via this feature's own testing, not assumed correct**:
1. KB-08's literal colon-suffix action-sub-resource syntax (`:id:cancel`) crashes NestJS route
   registration outright, and even escaped, real Fastify (production's actual adapter) matches the
   route but fails to bind the param — only caught by booting the real compiled server, not the
   e2e harness alone (which passed regardless). Used `/cancel` (slash) instead — this repo's one
   documented deviation from KB-08's literal syntax. `engineering/api-design` Skill entry #11.
2. A new `order.status` CHECK constraint broke four pre-existing, unrelated
   `capability-check.controller.ts` fixture inserts still using the old `'pending'` placeholder.
   `engineering/api-design` Skill entry #12.
3. The order list's filter form submitted empty fields as literal empty strings, not absent keys —
   the API correctly `400`'d, surfaced as an opaque "Something went wrong" error.
4. **The most significant**: `toOrderDto`'s optional `patient` field, added for the list/detail
   screens, set an explicit `patient: undefined` on `create()`/`cancel()`'s audited response.
   `writeAuditEvent`'s hash computation saw that key (`Object.keys()` includes undefined-valued
   keys); Postgres jsonb storage's own insert (`JSON.stringify`) silently drops it — a genuine,
   deterministic canonicalization mismatch, not a race, though it looked exactly like an
   intermittent one (order-dependent on which test file's writes landed first in the shared tenant
   chain). **Initially misdiagnosed** as a pre-existing `writeAuditEvent` concurrency race and filed
   as its own issue (#293) — including two real failures on this PR's own CI, not just locally, that
   looked like confirmation of that theory. Corrected once actually traced end-to-end instead of
   accepting the first plausible explanation: fixed both at the call site (conditional spread, never
   an explicit `undefined`) and at the root (`stableStringify` now skips undefined-valued keys,
   matching `JSON.stringify`). Verified 5/5 clean local e2e runs after the fix (was ~1/3 before).
   Issue #293 corrected with the real root cause and closed as fixed, not left open. Written up as
   `database-design` Skill entry #6 — a real, generically-applicable lesson: hashing an object bound
   for jsonb storage must treat undefined-valued keys the same way `JSON.stringify` does.

**Also found, not this feature's own bug but caught and fixed in passing**: `apps/api/openapi.json`
and `packages/sdk/src/schema.ts` had silently fallen one task behind `main` — TASK-042's own routes
merged without a `generate-openapi` re-run. Fixed as part of TASK-043; the underlying gap (no CI
check catches this drift automatically) filed separately as #292, not fixed.

Verified end-to-end with a real headless-Chromium browser across all three tasks (real
Keycloak/Postgres/`apps/api`, this sandbox's own missing-`libnss3.so` workaround): register →
search → profile → new order → catalog picker → panel selection → priority → place order → list →
filter by priority/status → detail → cancel → confirmed cancelled — every claim independently
re-verified via a direct API call, not just the UI's own claims. Full repo-wide `typecheck`/`lint`/
`build` and the complete `apps/api` e2e suite green throughout.

**Next**: FEAT-012's own next task, if any — EPIC-003 (Pre-Analytical Workflow) still has FEAT-013
(Accessioning, labels & reception, #22, not started) as its one remaining feature. `/orient`'s next
run should re-run milestone/next-task discovery from scratch rather than assume FEAT-013 is
automatically next — same discipline the previous session's own breadcrumb already established for
FEAT-012 itself.

---

# Status — 2026-08-03 (session 12)

Last commit on main: 5ae10f9 — "docs: FEAT-011 close-out -- breadcrumb refresh, plan doc marked
IMPLEMENTED (#288)".

## FEAT-011 fully closed this session: TASK-041 (search + profile screens) merged via PR #287
(`6e073ca`) — no tasks remain in the feature

Drafted the two Skills FEAT-011's own issue (#20) had flagged as missing across three prior
sessions (`engineering/api-design`, `domain/patient-identity`, both pushed to `lis-engineering`),
then a proposal revision, then implementation: `GET /v1/patients` gained a fourth, free-text `q`
search mode (partial name match, MRN/national-ID prefix match, capped at 50 results per ADR-0013's
pagination deferral), and two new `apps/web` screens — `/patients` (search/list) and
`/patients/[id]` (read-only profile). Sidebar's "Register patient" became "Patients".

**Deliberately narrower than the Stitch mockups** referenced in FEAT-011's own issue: no tabs, no
inline-editable demographics, no "Merge" action, no alerts display, no filter panel beyond the
search box — none of that has supporting API/data yet (`patient_alert` has no read route, no
`PATCH /v1/patients/:id` exists, patient merge has no mechanism anywhere). Full reasoning in
`docs/plans/feat-011-patient-management.md`'s TASK-041 revision §1/§5.

**Two real bugs found and fixed via this task's own testing, not assumed correct** (full detail in
the plan doc's new §11):
1. `getValidAccessToken()` (ADR-0014) threw `Cookies can only be modified in a Server Action or
   Route Handler` once the access token actually went stale mid-render — these two new screens are
   the first plain-GET Server Components in the repo to call `apps/api` at all (every prior call
   site was a Server Action). Real browser verification caught it directly, not a hypothetical.
   Fixed in `apps/web/auth/access-token.ts`: a refresh that can't persist its cookie still returns
   the refreshed token for that request; confirmed safe against Keycloak's default (non-rotating)
   refresh-token policy.
2. The new `q`-cap e2e test (seeding 51 rows) was flaky (`ECONNRESET`) firing all 51 seed requests
   via `Promise.all` against this suite's own `DB_POOL_MAX=1`. Fixed by seeding sequentially.
   Verified stable across 3 consecutive full-suite runs (28/28 each time) after the fix.

**Also hit, this session, unrelated to the feature work itself**: Docker Desktop's WSL2 backend
hung on startup for 10+ minutes with no daemon socket ever appearing, not a repeat of the prior
session's memory-pressure cause (both Windows and WSL had ample free memory this time) — resolved
by directly launching `Docker Desktop.exe` from the Windows host and waiting it out; no code
implication, noted only in case a future session hits the same thing.

Verified end-to-end with a real headless-Chromium browser (real Keycloak/Postgres/`apps/api`, this
sandbox's own missing-`libnss3.so`/Chromium-install workaround): register → search by MRN, by
partial name (different casing), and by national ID → click and separately Enter-key row activation
→ correct profile content → nonexistent-id real 404 state → sidebar nav label, all confirmed. Full
repo-wide `typecheck`/`lint`, `apps/api`'s e2e suite (28/28), and `apps/web`'s production build all
green.

`docs/plans/feat-011-patient-management.md`'s own top-level Status updated to `IMPLEMENTED` with all
four tasks' merge SHAs. FEAT-011 (#20) and TASK-041 (#100) both closed via comment (neither PR body
used a literal `Closes #N` line, so neither auto-closed — same recurring gotcha as `#99`/`#265`
before them; closed manually).

## Real staging outage this session, caused by our own docs-only merge — recovered, and the deploy
pipeline hardened so it can't recur the same way, via PR #285 (`9c7d739`)

Continuing the login investigation below: a docs-only breadcrumb-refresh PR's merge (#282) auto-
triggered a full "Deploy to Staging" run (no path filtering existed yet), which hit a Keycloak
readiness/token-endpoint timeout and died with `api`/`web` already stopped but never restarted —
real staging was down (502) until this was noticed and the run manually retried. Fixed at the root,
via PR #285: (1) `deploy-staging.yml` now has `paths-ignore` for `docs/**`/root `*.md`, so a pure
documentation merge no longer redeploys at all; (2) the Keycloak-readiness/`unmanagedAttributePolicy`
re-apply block is now non-fatal (warns instead of `exit 1`) — `api`/`web` restarting no longer depends
on that block succeeding, since realm/client config is already live as soon as `--import-realm`
completes. Validated the happy-path GET/merge/PUT sequence unchanged against real local Keycloak
before shipping. **Confirmed live**: this exact fix's own deploy (triggered by its own merge, since
it touches `deploy-staging.yml` itself) completed successfully and staging is serving correctly.

## Real root cause of the staging login-rejection mystery, found — and why the first fix (PR #283)
didn't address it

Chased an elaborate, well-validated but ultimately wrong hypothesis first (Keycloak's JVM heap
capped at `-Xmx224m` on the droplet's 1vCPU/1GB budget making PBKDF2 password-hash import unreliable
under memory pressure) — validated it against an isolated Keycloak instance and the real local stack,
shipped it as PR #283 (pre-hashed `test-user*` credentials in `lis-realm.json`), merged, redeployed.
**Staging login was still rejected afterward.** The actual cause, found only after: `deploy-staging.yml`
has an explicit step ("Strip local/CI-only test user from the realm export for staging") that deletes
the realm file's entire `.users` array before it ever reaches the droplet — a deliberate, sensible
security decision (staging is network-reachable; a well-known `test-password` shouldn't be there).
**`test-user` has never existed on staging's Keycloak, by design.** PR #283 itself isn't wrong or
harmful (real improvement for local/CI imports) but did not and could not fix the staging issue.
Written up as a new `AGENTS.md` standing rule (PR #284, `cb5df41`): check the deploy workflow's own
file-transformation steps before reasoning about runtime/environment differences.

**Real account for staging is `login-test-user`** (created live, directly on the droplet, per PR
#278's own description — consistent with bulk test-users being deliberately excluded). Investigation
paused here at the human's own request, to make progress on other things. Live leads not yet chased:
(1) a live-created user needs an explicit follow-up attribute-set step for `tenant_id`, or it's
silently missing (authentication Skill entries #7-#10) — this would explain the `ERR_TOO_MANY_REDIRECTS`
loop seen when logging into a freshly-created staging user; (2) the Keycloak admin console
(`https://lis-staging.taila0fbf9.ts.net:8443/admin/master/console/`, user `admin`) needs the
`KEYCLOAK_ADMIN_PASSWORD` GitHub Actions secret's current value, which — since Keycloak has no
persisted data and is fully recreated every deploy — can simply be rotated to a known value and
redeployed if it isn't already known, rather than needing to be "recovered."

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

**Confirmed the real way, 2026-08-03**: a human logged into `apps/web` locally
(`pnpm --filter web dev`, real local Keycloak/Postgres) through the actual browser flow, landed on
`/` authenticated, then opened a second, independent tab to the same URL — the exact "next request"
shape of the original bug — and stayed authenticated. The fix is confirmed end-to-end, not just via
a Docker-image repro. See `authentication` Skill entry #12.

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

**M3 — Pre-Analytical Workflow: FEAT-011 fully closed this session (see the section at the top of
this file).** All four tasks merged: TASK-038 (#97, PR #261), TASK-039 (#98, PR #263), TASK-040
(#99, PR #271), TASK-041 (#100, PR #287). The session-token bridge (#265, TASK-040's own
prerequisite) closed via PR #266. `engineering/api-design` and `domain/patient-identity` Skills
(named as "Required Skills" by FEAT-011's own issue, #20) were drafted from real TASK-038/039/040
decisions ahead of TASK-041's own implementation — both pushed to `lis-engineering`. FEAT-011 (#20)
and TASK-041 (#100) both closed via comment. **No open task remains in M3** — its next task, if any,
is not yet identified; `/orient`'s next run should re-run milestone discovery from scratch rather
than assume M3 continues in any particular direction.

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
