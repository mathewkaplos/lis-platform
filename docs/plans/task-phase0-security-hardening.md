# Implementation Proposal: Phase 0 security/operational hardening (world-class execution plan)
Status: APPROVED
ADR: none (dependency/config hardening, no architecture change)    Date: 2026-09-24    Backlog ID: `docs/world-class-execution-plan-8-2026-09.md` Phase 0

**Approved 2026-09-24** — explicit, detailed task instructions from Mathew authorizing exactly
these four items, with constraints, a Definition of Done, and a required final report format.
Treated as approval of this proposal rather than a separate AskUserQuestion round, since the
instructions already specify the approach in more detail than a proposal normally would.

## 1. Independently re-verified findings (not trusted from the prior session's assessment alone)

Re-ran `pnpm audit --json` fresh this session and cross-checked against `pnpm why`/`npm view`:

- **`next@16.2.12`** (apps/web): two **critical** advisories, both direct on `next` itself —
  GHSA-p293-qw3h-jr36 (unauthenticated RCE on Windows-hosted servers) and GHSA-2xp9-vwfh-vxw4
  (unauthenticated RCE via Image Optimization API with AVIF). Vulnerable range `>=16.0.0 <16.3.3`,
  patched `>=16.3.3`. `next-intl@^4.13.6`'s own peer range (`^12 || ... || ^16.0.0`) comfortably
  covers `16.3.6` (the current `latest` dist-tag, a same-major patch release — the safest
  compatible option, no major-version jump). `eslint-config-next`/`@next/eslint-plugin-next` are
  both pinned at `16.2.12` in lockfile entries and must move in lockstep.
- **`@nestjs/platform-express`** (apps/api only — confirmed via `grep`, not present in
  `apps/gateway`/`apps/interop`'s package.json): zero references anywhere in `apps/api/src` or
  `apps/api/test` to `FileInterceptor`/`FilesInterceptor`/`NestExpressApplication`/anything
  Express-platform-specific. `apps/api/src/main.ts` bootstraps exclusively via
  `NestFastifyApplication`. `pnpm why multer` traces `multer@2.2.0` (itself already below its own
  patched `>=2.3.0` line — 3 of the 32 high-severity findings) to `@nestjs/platform-express` alone.
  `@nestjs/testing` (a devDependency of all three Node apps) lists `@nestjs/platform-express` only
  as an *optional* peer dependency (`peerDependenciesMeta.platform-express.optional: true`,
  confirmed via `npm view`) — gateway/interop never actually install it, only api's own explicit
  `dependencies` entry does. Genuinely unused; safe to remove.
- **Keycloak realm** (`infra/keycloak/lis-realm.json`): `bruteForceProtected`, `failureFactor`,
  `waitIncrementSeconds`, `permanentLockout`, and `passwordPolicy` are all `null` (unset) —
  confirmed via direct `jq` inspection, not assumed from the prior assessment.
- **Sentry**: `SENTRY_DSN` is wired into `infra/docker-compose.staging.yml`'s `api` service env, but
  no evidence exists in this repo or session of a real event ever having reached the configured
  Sentry project from the actual deployed environment.

## 2. Approach

### 2.1 Next.js upgrade
- Bump `apps/web/package.json`: `next` → `16.3.6`, `eslint-config-next` → `16.3.6` (matching pair,
  same convention this repo already follows keeping them in lockstep).
- `pnpm install` to regenerate the lockfile (not a manual lockfile hand-edit).
- `pnpm --filter web build`, `pnpm --filter web test`, `pnpm --filter web typecheck`,
  `pnpm --filter web lint`.
- `pnpm --filter web test:e2e` (Playwright) against the real local stack.
- Re-run `pnpm audit`; confirm both critical `next` advisories are gone.

### 2.2 Remove `@nestjs/platform-express`
- Remove the single line from `apps/api/package.json`'s `dependencies`.
- `pnpm install` to regenerate the lockfile.
- `pnpm --filter api build`, `pnpm --filter api test`, `pnpm --filter api test:e2e` (confirms
  Fastify bootstrap, Swagger, and every existing e2e spec still pass with the dependency gone).
- Re-run `pnpm audit`; confirm `multer`'s findings are gone from the report.

### 2.3 Keycloak hardening
- Add to the realm root (`infra/keycloak/lis-realm.json`), using Keycloak 26's own documented
  out-of-the-box defaults for "enable brute force detection" via its admin console (conservative,
  not invented) — chosen specifically so a pilot user mistyping a password a few times is never
  locked out, but a rapid automated attack is slowed and eventually stopped:
  - `"bruteForceProtected": true`
  - `"failureFactor": 30` (30 failed attempts before any lockout starts — generous for real users)
  - `"waitIncrementSeconds": 60`
  - `"quickLoginCheckMilliSeconds": 1000`
  - `"minimumQuickLoginWaitSeconds": 60`
  - `"maxFailureWaitSeconds": 900` (15 minutes, capped — never a permanent lock)
  - `"maxDeltaTimeSeconds": 43200`
  - `"permanentLockout": false` (explicit — never permanently locks a real user out)
- Add a minimal password policy: `"passwordPolicy": "length(8) and notUsername(undefined)"` —
  Keycloak's own serialization format. Does not retroactively invalidate the already-seeded
  `test-user`/`test-user-2`/... credentials (Keycloak only enforces a password policy at
  credential-set time, never retroactively against existing stored credentials — confirmed
  against Keycloak's own documented behavior), so no existing login breaks. Deliberately minimal
  per the task's own instruction not to invent aggressive policies.
- No change to `clients`, `redirectUris`, session lifetimes, or authentication architecture.
- Validate: `docker compose restart keycloak` (or re-import) locally, confirm
  `curl http://localhost:8080/realms/lis/.well-known/openid-configuration` still 200s, confirm
  `getKeycloakToken('test-user', 'test-password')` (the existing e2e helper) still succeeds, then
  run `apps/api`'s `auth.e2e-spec.ts` and `tenant-context.e2e-spec.ts` (the specs most directly
  exercising login/session behavior).

### 2.4 Sentry production-event verification
- This is a **verification task, not a code change**. Plan:
  1. Check whether this session has any real credential/access to the actual Sentry project tied
     to the production `SENTRY_DSN` secret (it is a GitHub Actions secret, injected only into the
     real droplet's `.env` at deploy time — not available to this local session).
  2. If no such access exists, **do not fabricate a production event or claim success** — the task
     instructions explicitly require documenting the exact blocker rather than claiming completion.
  3. Document precisely what verification *would* look like and what's missing, so a human with
     Sentry project access can complete the last step in minutes.

## 3. Files touched

- `apps/web/package.json`, `pnpm-lock.yaml` (next/eslint-config-next bump)
- `apps/api/package.json`, `pnpm-lock.yaml` (platform-express removal)
- `infra/keycloak/lis-realm.json` (brute-force + password policy)
- `docs/world-class-execution-plan-8-2026-09.md` (mark Phase 0 items complete/blocked with evidence)
- This proposal file

## 4. Explicitly out of scope (per task instructions)

No changes to billing, AP workflows, histology, FHIR, AI, protocol authoring, authentication
architecture, MFA/OTP, or anything beyond the four named items.

## 5. Risk

Low for 2.1/2.2 (dependency-only changes, fully covered by existing build/test/e2e suites). Low
for 2.3 (additive realm fields, non-retroactive, generous thresholds, no architecture change).
2.4 carries a real chance of ending in "documented blocker" rather than "verified" — that is an
acceptable, expected outcome per the task's own instructions, not a failure of this plan.
