# Implementation Proposal: FEAT-049 Self-service onboarding (first slice)
Status: APPROVED
ADR: adr-0040 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-049 (#58)

**Approved 2026-08-11** via the native options-prompt (all four §10 questions accepted as
drafted: single-page signup, unconditional dual-catalog seed, ADR-0040 accepted, no rate-limiting
in this slice — tracked as a required pre-launch follow-up).

## 1. Goal
M10's exit criterion is "a second tenant self-onboards, runs isolated in its region, and is
billed"; its demo outcome is "a lab I have never met signed up, configured their own tests, and ran
a week of work." FEAT-045 (just shipped) built the tenant registry + isolation-tier mechanism but
deliberately shipped no way to *create* a tenant except a manual DB row — this feature is what
actually operationalizes it: a real lab can sign up and start operating with zero developer
involvement.

Literal acceptance criterion (issue #58): "A new tenant can complete the first-time-setup wizard and
begin operating without developer intervention."

This proposal scopes the **real, provable first slice** of that: a single-page signup (not the
Stitch prompt's full 5-step wizard — see §5) that creates a real tenant, a real Keycloak user, and
a real starter test catalog, then gets the new user logged in through the existing, already-proven
login flow. Branches/sites, team invites, and true per-discipline catalog selection are explicitly
deferred — see §5's own reasoning for each.

## 2. Affected files
- `~/work/lis-engineering/adr/adr-0040-self-service-onboarding-uses-a-dedicated-keycloak-service-account-and-a-committed-user-profile-fix.md` (new, drafted, Status: proposed) — the Keycloak provisioning mechanism decision.
- `infra/keycloak/lis-realm.json` — new `lis-onboarding` confidential service-account client
  (`manage-users` on `realm-management` only, per ADR-0040); realm's `users profile` config gains
  `unmanagedAttributePolicy: "ENABLED"` (closing `authentication` Skill entry #14's flagged gap).
- `apps/api/src/onboarding/` (new module):
  - `onboarding.controller.ts` — `POST /onboarding/signup`, **no** `JwtAuthGuard`/
    `TenantContextInterceptor` (there is no tenant yet when this is called — this is the one
    deliberately public, unauthenticated mutation route in the codebase).
  - `onboarding.service.ts` — orchestrates: create Keycloak user (via the admin auth service below)
    → create `tenant` row (FEAT-045's table, `shared` tier) → seed the starter catalog for the new
    tenant → write an audit event (`actorType: 'system'`... actually `'human'`, the new admin,
    once their principal id is known — resolved during implementation, not a proposal-level
    decision).
  - `keycloak-admin-auth.service.ts` — client-credentials token fetch against `lis-onboarding`,
    mirroring `apps/interop/src/auth/interop-auth.service.ts` exactly (same cache-and-refresh
    shape, same plain-`fetch` convention, no new SDK dependency).
  - `onboarding.module.ts`.
- `packages/db/src/tenant-catalog-seed.ts` (new) — a parameterized version of the tenant-scoped
  rows `db/seed/chemistry-catalog.sql`/`haematology-catalog.sql` already insert (`test_definition`,
  `panel`, `panel_test`, `test_analyte`, `reference_range`), looked up against the existing
  **global** `analyte`/`unit`/`code_system_value` rows those seed files already created (ADR-0004)
  — never re-inserts global rows, only creates the new tenant's own copy of the tenant-scoped ones.
- `apps/web/app/(public)/signup/` (new route group + page) — a single-page form using existing
  `packages/ui` primitives (`form-field`, `input`, `button`, `card`): org name, admin email,
  admin password. On success, redirects into the **existing** login route
  (`apps/web/app/api/auth/login`) rather than minting a session directly — reuses the
  already-proven OIDC flow instead of a second, parallel one.
- `apps/api/test/onboarding.e2e-spec.ts` (new) — real Postgres + real Keycloak: full signup → the
  new user can log in through the real login flow → their tenant's seeded catalog is visible to
  them and invisible to every other tenant (a live isolation proof, same standard
  `rls-isolation-check.ts`/FEAT-045's own checks already establish).
- `~/work/lis-engineering/skills/engineering/authentication/SKILL.md` — entry #14's flagged gap
  ("promote `unmanagedAttributePolicy` before the next live custom-attribute write") gets marked
  closed, with a new entry recording whatever real friction this feature's implementation hits
  (matching this repo's own convention of Skills growing from real corrections, not written ahead
  of need).

## 3. Architecture consulted
- KB-51 (Commercialization) — "fast onboarding... get a lab live in days, not months," the direct
  product goal this feature serves.
- KB-38 (Multi-Tenancy) — every new tenant lands on the `shared` tier by default (FEAT-045's own
  established default).
- ADR-0009 (single Keycloak realm, `tenant_id` user attribute) — the new user's `tenant_id` claim
  is the same mechanism every existing user already relies on.
- ADR-0026 (gateway's dedicated client-credentials client, narrowest sufficient grant) — the direct
  precedent `lis-onboarding` (ADR-0040) follows.
- ADR-0004 (global vs. tenant-scoped catalog tables) — `tenant-catalog-seed.ts` must respect this
  split: reuse global rows, create only the tenant-scoped copies.
- `engineering/authentication` Skill entries #1 (undefined-scope import gotchas), #10 (the
  unmanaged-attribute silent-drop gap this feature is the forcing function to finally close), #14
  (this exact gap, already flagged as "close before the next live write").
- `engineering/frontend-design` Skill — required reading per the `plan` Skill's own rule (any new
  `apps/web` page pulls this in regardless of whether the feature's issue names it).

## 4. Skills loaded
- `engineering/authentication` (required by the feature's own GitHub issue).
- `engineering/frontend-design` (new `apps/web` page — recurring-mistake entries on function-valued
  props into Client Components, `'use server'` exports, route-group URL prefixes).
- `engineering/rls-multi-tenancy` — a new tenant/new tenant-scoped rows are being created live, not
  via migration; entry #4's structural-plus-live-leak proof standard applies to the e2e test.
- `engineering/database-design` — seed-data/parameterization conventions.

## 5. Assumptions & autonomous decisions
- **Single-page signup, not the full Stitch §2.7 wizard.** The prompt describes 5 steps (org
  profile → branches/sites → disciplines → invite team → preferences → done). Two of those have no
  backing data model at all today: no `branch`/`facility` table exists anywhere in the schema
  (confirmed by search), and `test_definition` has no `discipline` column to select against. Building
  either properly is its own real, separate scope (a facility/site model; a discipline taxonomy) —
  not invented speculatively here. "Invite team" is a distinct multi-user-management concern this
  slice doesn't need to prove the core mechanism. This slice ships exactly enough to satisfy the
  literal AC — org name + one admin account — and defers the rest to explicit follow-up
  issues/tasks, tracked in §6, not silently dropped.
- **Every new tenant is seeded with both existing starter catalogs (chemistry + haematology)
  unconditionally** — the same placeholder packs the fixed seed tenant already gets via
  `db-reset.sh`. No true "pick your disciplines" selector ships, since there's no `discipline`
  column to select against yet (see above).
- **Every new tenant lands on the `shared` isolation tier.** No tier-selection UI — FEAT-045 itself
  shipped no self-service tier-assignment mechanism either, so this is consistent, not a new gap.
- **No billing/payment gate.** FEAT-046 doesn't exist yet; signup is unrestricted in this slice.
  M10's exit criterion pairs "self-onboards" with "is billed" as two separate features, not one —
  this is the first, FEAT-046 is the second.
- **"Auto-login" reuses the existing login route**, not a new session-minting code path — the
  signup page redirects the browser into `apps/web`'s already-proven OIDC login flow once the real
  Keycloak user exists, rather than duplicating session/cookie-signing logic.
- **New user is granted the existing `qa` role**, not a new `owner`/`admin` role — `qa` already
  carries `manage_catalog`/`manage_workflow`/`manage_report_templates`, the closest existing fit for
  "configure their own tests," matching `capabilities.ts`'s own established discipline of not
  inventing a role ahead of a second real need for it.
- **No CAPTCHA/rate-limiting/email-verification** in this slice — see Risks.

## 6. Risks
- **A public, unauthenticated, user-and-tenant-creating endpoint with zero abuse protection is a
  real production risk if this ever faces open internet traffic.** Acceptable for this milestone's
  actual, stated goal (prove a lab that's "never met you" can self-onboard, on staging, for a demo)
  — **not** acceptable to leave unaddressed before any real public launch. Tracked explicitly as a
  required follow-up before FEAT-049 is considered production-ready, not silently shipped as if
  solved.
- **Partial-failure ordering.** Two external-ish operations (Keycloak user creation, `tenant` row +
  catalog-seed transaction) can't both succeed atomically. Order: create the Keycloak user *first*
  — if it succeeds but the subsequent DB transaction fails, the result is an orphaned Keycloak user
  with no tenant (harmless: no data, cheap to clean up or retry), never the reverse (a tenant/catalog
  existing with no way to log into it).
- **`lis-onboarding`'s client secret is a genuinely privileged credential** (can create users in any
  tenant) — same operational category as `lis-gateway`/`lis-interop`'s secrets (ADR-0040).
- **`tenant-catalog-seed.ts` must not accidentally re-insert or duplicate the global `analyte`/
  `unit`/`code_system_value` rows** — a data-design mistake here would violate ADR-0004's own
  established split.

## 7. Acceptance criteria
- [ ] Submitting the signup form (org name, admin email, admin password) creates: one `tenant` row
      (`shared` tier), one real Keycloak user (`qa` role, correct `tenant_id`), and that tenant's own
      copy of the chemistry + haematology starter catalogs.
- [ ] The new user can immediately log in through the existing, unmodified login flow and reach an
      authenticated page.
- [ ] The new tenant's seeded catalog is visible only to that tenant — proven by a real, live
      cross-tenant check (not read-code-and-assume), same standard as every other RLS proof in this
      repo.
- [ ] No existing user, tenant, or route's behavior changes.
- [ ] `unmanagedAttributePolicy: "ENABLED"` is committed in `lis-realm.json` itself, verified by a
      fresh `docker compose up --force-recreate keycloak` still working correctly (not a live-only
      fix that silently stops working on the next container recreate).

## 8. Testing plan
- Unit: `onboarding.service.spec.ts` — orchestration order (Keycloak-first), error handling on a
  failed Keycloak call (no DB writes attempted), mocked `fetch`.
- Unit: `tenant-catalog-seed.spec.ts` — correct tenant-scoped rows inserted, correct global-row
  reuse (no duplicate `analyte`/`unit` rows), given a real Postgres connection (per
  `engineering/testing` entry #1's real-Postgres-for-DB-logic convention).
- e2e (real Postgres + real Keycloak): `onboarding.e2e-spec.ts` — full signup → login → tenant
  isolation proof, as described in §2.
- Manual: the signup page driven through a real headless browser (per `web-verify`), light/dark,
  keyboard-only, all four UI states (empty/loading/populated/error on validation failure).

## 9. Rollback plan
New module, new route, new Keycloak client, no changes to any existing table or route — a plain
revert removes the entire feature with no data or contract implications for anything else. The
`lis-onboarding` Keycloak client can additionally be disabled directly in Keycloak as an immediate
mitigation, independent of any code revert, if the endpoint is ever abused before a code fix ships.

## 10. Questions requiring human approval
1. **Approve shipping only a single-page signup form** (org name + one admin account) for this
   slice, explicitly deferring branches/sites, team invites, and true per-discipline catalog
   selection (Stitch §2.7's fuller wizard) to later, separately-tracked work?
2. **Approve seeding every new self-service tenant with both existing starter catalogs
   unconditionally**, with no real "pick your disciplines" selector yet (no `discipline` column
   exists to select against)?
3. **Approve ADR-0040** (dedicated `lis-onboarding` Keycloak service-account client with only
   `manage-users`; `unmanagedAttributePolicy` promoted into the committed realm file) as this
   feature's provisioning mechanism?
4. **Approve shipping this slice with no rate-limiting/CAPTCHA/email-verification** on the public
   signup endpoint, as an explicitly tracked pre-launch follow-up rather than a blocker for this
   milestone's own demo goal?
