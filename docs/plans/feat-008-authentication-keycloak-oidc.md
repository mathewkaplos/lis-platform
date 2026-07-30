# Implementation Proposal: FEAT-008 Authentication (Keycloak/OIDC)
Status: APPROVED
ADR: adr-0009 (realm/tenant model, proposed), adr-0010 (RLS binding under pooling, proposed)    Date: 2026-07-30
Backlog ID: FEAT-008 (#17) / TASK-028 (#87), TASK-029 (#88), TASK-030 (#89), TASK-031 (#90)

## 1. Goal

FEAT-008 (#17) is M2's entry point — M1 is functionally exhausted (its three remaining
open issues are each individually blocked: #86/#16 on an external design-partner review,
#145 explicitly deprioritized until a global tenant table exists). FEAT-008's own purpose,
stated in its issue: "real, provable identity before any clinical write is possible." Its
only dependency is FEAT-006 (closed), and everything downstream that touches real clinical
data — starting with TASK-030 itself — needs this to exist first.

Four tasks, covered together by this one proposal per the FEAT-004/005/006/007 precedent
of one proposal per feature: TASK-028 (deploy Keycloak; realm/clients/roles), TASK-029
(API auth guard: JWT validation, tenant/user context), TASK-030 (bind the RLS session
variable to the authenticated tenant), TASK-031 (web login/session/logout).

This is the first feature to introduce infrastructure outside the existing
pnpm/Postgres/Valkey stack (Keycloak), the first to put real authentication in front of
`apps/api` (currently a bare `/health` endpoint with no guard at all), and the first to
connect `apps/api` to the database as anything other than a single-shot verification
script — which surfaces a real, previously-latent architectural gap: every existing
`app.tenant_id` binding (`rls-isolation-check.ts`, `golden-dataset-check.ts`) uses
session-level `set_config(..., false)` from a short-lived, single-tenant process. `apps/api`
uses a pooled `pg.Pool` (`packages/db/src/client.ts`) serving many tenants' requests over
the same small set of physical connections — the existing pattern is not safe to reuse
verbatim here (see §5/§6).

## 2. Affected files

- `infra/keycloak/lis-realm.json` (new) — versioned realm export (realm, one confidential
  client for `apps/api`/`apps/web`, roles, a `tenant_id` protocol mapper — see §10 Q1),
  imported on container start rather than configured by hand, matching this repo's
  everything-as-code convention (migrations, Terraform, GH Actions).
- `docker-compose.yml` — new `keycloak` service (local dev), importing the realm above.
- `infra/docker-compose.staging.yml` — new `keycloak` service, `KEYCLOAK_ADMIN_PASSWORD`
  and `KEYCLOAK_CLIENT_SECRET` sourced from `.env`, same pattern
  `LIS_APP_DB_PASSWORD`/`SENTRY_DSN` already use.
- `.github/workflows/deploy-staging.yml` — two new `secrets.*` entries written to the
  remote `.env`, mirroring the existing `LIS_APP_DB_PASSWORD` block.
- `.github/workflows/pr.yml` — a CI `keycloak` service + realm-import step, needed for
  TASK-029/030's integration tests; same "CI does not inherit local dev's bootstrap"
  lesson `engineering/testing` Skill entry #3 already established for Postgres.
- `apps/api/src/auth/` (new module) — `JwtAuthGuard` (verifies via JWKS, rejects
  unauthenticated/invalid requests with 401), a `RequestContext`
  (`sub`/`tenantId`/`roles`) populated by the guard, and a `TenantContextInterceptor`
  that wraps each request's DB work in a transaction and issues `SET LOCAL
  app.tenant_id` (see §5/§6 — this is the load-bearing piece of this whole feature).
- `apps/web/src/auth/` (new) — login/callback/logout routes, PKCE flow against Keycloak,
  an httpOnly-cookie session (never the raw IdP token in browser JS), a protected-route
  wrapper.
- `~/work/lis-engineering/skills/engineering/authentication/SKILL.md` (new) — required by
  FEAT-008's own issue (`Required Skills`) and does not exist yet, same recurring gap
  class FEAT-006/FEAT-007 each hit and resolved by authoring the missing Skill on the
  task that first needed it. TASK-030 is the natural task to author it here, since that's
  where the pooling/`SET LOCAL` finding is made.
- `~/work/lis-engineering/adr/adr-0009-...md`, `adr-0010-...md` (new) — see §10.
- `docs/scope/current.md` — breadcrumb update once the feature closes.

## 3. Architecture consulted

- **KB-09 Identity Architecture** — central OIDC/OAuth 2.1 IdP as single authority;
  "the `tenant_id` claim is authoritative... the gateway sets the tenant into the
  request/DB session (`app.tenant_id`) that RLS reads" — the literal design this
  proposal implements. Notes MFA-for-privileged and step-up as required but out of
  scope for *this* feature (no privileged/sign-off actions exist yet at M2).
- **KB-37 Security** — referenced by FEAT-008's own issue; general security posture,
  consulted for token/session handling (no PHI/secrets logged, short-lived tokens).
- **KB-38 Multi-Tenancy** — shared-schema + RLS as the default isolation tier (what M1
  already built); does not address IdP-side tenant modeling (realm-per-tenant vs.
  attribute-based) at all — a genuine gap, hence §10 Q1.
- **KB-06 Database Architecture** — `app.tenant_id` as the session variable RLS policies
  read; does not address connection-pooling safety for setting it — the second genuine
  gap, hence §10 Q2.
- **Constitution Law #4** — tenant isolation is structural (RLS), "not an application
  `if` check." This proposal's core risk (§6) is exactly the scenario where that
  structural guarantee can be silently defeated by an incorrect binding mechanism, not
  a schema mistake.
- **`rls-multi-tenancy` Skill** — existing `set_config(..., false)` convention from
  `rls-isolation-check.ts`/`golden-dataset-check.ts`; explicitly *not* reused as-is here
  (single-shot script vs. pooled multi-tenant server are different safety requirements)
  — flagged there wasn't a decision on this yet, confirmed by grep, not assumed.
- **ADR-0005** — precedent for reusing a generically-named, still-applicable ADR rather
  than drafting a redundant one; not directly reusable here (no forward-reference column
  involved) but the same "resolve once, cite forever" intent motivates drafting
  ADR-0009/0010 now rather than re-litigating tenant-binding per future feature.

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (implementation step once
  approved).
- `rls-multi-tenancy` — the existing tenant_id/RLS convention this feature must bind to
  correctly; its own "not yet covered" section doesn't address pooling, consistent with
  §10 Q2 being genuinely new ground.
- `engineering/testing` — the CI migrate→seed→run wiring pattern, reused here for
  Keycloak's own CI bootstrap step.
- `engineering/authentication` — **required by FEAT-008's own issue and does not exist
  yet**; authored as part of TASK-030 (see §2), not deferred again.

## 5. Assumptions & autonomous decisions

- **No new `user`, `tenant`, or `organization` Postgres table.** Per KB-09, the IdP is
  "the single authority" for identity; `tenant_id` continues exactly as already
  established (TASK-016 through TASK-025): a bare, unFK'd `uuid` column, per ADR-0005's
  forward-reference precedent (no table exists yet to FK against). This proposal does
  not change that.
- **Organization/branch selection is out of scope for this feature**, despite FEAT-008's
  issue listing Google Stitch prompts §2.5/§2.6 (Org/Branch Selection) alongside §2.1
  (Login). None of the four tasks' literal ACs require org/branch switching — that
  functionality belongs to TASK-036 (App shell: org/branch switcher, FEAT-010, also M2).
  This proposal treats §2.5/§2.6 as available for future design-token extraction only.
  Flagged explicitly since it's a real scope boundary, not an unambiguous reading — same
  move FEAT-006 §5 made for KB-02's fuller `Order` aggregate.
- **JWT verification via `jose`'s `createRemoteJWKSet`/`jwtVerify`** (built-in JWKS
  caching), not a heavier Keycloak-specific NestJS adapter or Passport strategy — matches
  the existing "thin, typed, gets out of the way" tool-selection philosophy already used
  for Drizzle over a heavier ORM. Implementation-detail library choice, not routed to
  §10.
- **Web OIDC flow: Authorization Code + PKCE**, no client secret in the browser (implicit
  flow is deprecated under OAuth 2.1, which KB-09 specifies). `apps/web` keeps its own
  short-lived httpOnly-cookie session rather than exposing the raw Keycloak token to
  browser JS (standard OIDC BFF pattern). Implemented directly on `openid-client` rather
  than pulling in a Next.js-specific auth framework this early — a Keycloak-specific
  tenant-claim flow is easier to get exactly right against a lower-level library than to
  fight a generic provider abstraction for. Not routed to §10 — reversible implementation
  choice, no data-shape implications.
- **Realm/client/role config is a checked-in, versioned JSON export**
  (`infra/keycloak/lis-realm.json`), imported on container start — not manual
  admin-console configuration. Matches this repo's everything-as-code convention; the
  same discipline already applied to migrations ("never edited after the fact") applies
  here: change the file, re-import, never hand-edit the running instance.
- **The seeded test user's `tenant_id` attribute is the existing fixed seed tenant**
  (`00000000-0000-0000-0000-000000000001`) already used throughout
  `db/seed/chemistry-catalog.sql`, `rls-isolation-check.ts`, and
  `golden-dataset-check.ts` — so TASK-028's test user composes with existing seed data
  rather than introducing a second, inconsistent tenant fixture.

## 6. Risks

- **Pooled-connection cross-tenant leakage is the single highest-severity risk in this
  feature.** `apps/api` connects via `pg.Pool` (`packages/db/src/client.ts`); a session-
  level `set_config('app.tenant_id', ..., false)` — the pattern the two existing
  verification scripts use — would persist on a physical connection across requests once
  it's returned to the pool, silently leaking one tenant's context into the next
  unrelated request that happens to reuse that connection. This is not a hypothetical:
  it is the default failure mode of RLS-session-variable-plus-pooling unless explicitly
  designed around. Mitigation (§5): every request wraps its DB work in a transaction and
  issues `SET LOCAL app.tenant_id` (transaction-scoped, automatically cleared at
  COMMIT/ROLLBACK, safe under pooling by construction) — never session-level
  `set_config`. This must have an explicit negative test forcing pool reuse across two
  different tenants' requests (§8), not just a green single-tenant pass — the failure
  mode here doesn't error, it returns the wrong tenant's data.
- **Keycloak becomes a new hard dependency for every authenticated request.** KB-09
  states and accepts this trade-off explicitly. Local dev and CI must both provision it
  reliably (§2) or every downstream M2+ task stalls behind a flaky auth dependency.
- **Realm-export drift**: if anyone hand-edits the running Keycloak instance instead of
  `infra/keycloak/lis-realm.json`, the checked-in file silently stops matching reality —
  same risk class as "migrations are never edited after the fact," same discipline
  required.
- **`engineering/authentication` Skill doesn't exist yet** — authored as part of
  TASK-030 per §2, not deferred.
- **No Constitution Gate regex currently targets auth-guard coverage** (unlike the
  RLS/audit patterns it already checks). A guard that exists but isn't actually applied
  to a given route could pass CI without being caught structurally — the testing plan's
  negative case (§8, item 3) is the real proof here, not the Gate.

## 7. Acceptance criteria

FEAT-008's feature-level AC, plus how each will be judged:
- [ ] Keycloak issues a valid token for a test user against the configured realm —
      TASK-028. Judged by a direct token-endpoint call against the imported realm.
- [ ] Unauthenticated API requests return 401 — TASK-029. Judged by an unauthenticated
      request to a guarded route.
- [ ] Authenticated tenant context is correctly resolved and bound to RLS — TASK-030.
      Judged by the existing `rls-isolation-check.ts` assertions re-run through the live
      API (not direct SQL), plus the pooling negative case in §8.
- [ ] Full login → authenticated app → logout flow works end-to-end in the browser —
      TASK-031. Judged by a real browser session (manual or Playwright once it exists).

TASK-level AC:
- [ ] TASK-028 (#87): "A test user can obtain a valid token against the configured
      realm" — as above.
- [ ] TASK-029 (#88): "An unauthenticated request returns 401; a valid token resolves
      correct tenant and user" — as above.
- [ ] TASK-030 (#89): "The RLS isolation test passes when exercised through the live
      API, not only in SQL" — as above.
- [ ] TASK-031 (#90): "Full login → authenticated app → logout flow works correctly in
      the browser" — as above.

## 8. Testing plan

1. `docker compose up keycloak` locally; confirm realm import succeeds and the admin
   console is reachable.
2. Request a token for the seeded test user (tenant attribute = the fixed seed tenant)
   directly against the token endpoint; confirm a valid JWT with the expected claims
   (`sub`, `tenant_id`, roles) — TASK-028 AC.
3. Unauthenticated request to a guarded `apps/api` route → confirm 401 — TASK-029 AC.
4. Authenticated request with a valid token → confirm the guard resolves the correct
   `sub`/`tenant_id` into request context — TASK-029 AC.
5. **Pooling negative case (the critical test in this proposal):** force a small pool
   size (e.g. 1) in a test harness; issue two requests in sequence from two different
   tenants sharing that single physical connection; confirm the second request never
   sees the first tenant's data and vice versa. This is the concrete proof that `SET
   LOCAL`-per-transaction actually holds under pooling, not just in the trivial
   single-connection case. Per ADR-0010's acceptance criteria.
6. **Fail-closed negative case (ADR-0010):** exercise a tenant-scoped query path where
   the `TenantContextInterceptor`'s `SET LOCAL` deliberately did not run (e.g. connect
   directly, bypassing the interceptor); confirm the query returns zero rows or errors
   — never proceeds as if some other tenant's context applied. Proves the binding
   mechanism fails closed, not just that it works on the happy path.
7. Re-run `rls-isolation-check.ts`'s existing assertions, but exercised through the live
   authenticated API rather than direct SQL — literal TASK-030 AC.
8. Browser: full login → protected page renders authenticated content → logout →
   protected page redirects back to login — TASK-031 AC.
9. CI: confirm the new `keycloak` service + realm-import step in `pr.yml` runs green,
   and that TASK-029/030's integration tests actually execute in CI (not skipped for
   lack of a Keycloak instance there).
10. `docker compose down -v` for a clean teardown afterward.

## 9. Rollback plan

Purely additive at the infrastructure and application level — no new migration, no
existing table/data changes. Rollback is reverting the PR(s): the new Keycloak service
blocks in `docker-compose.yml`/`infra/docker-compose.staging.yml` are self-contained,
the new `apps/api/src/auth/` and `apps/web/src/auth/` modules are new code paths with no
prior callers to break, and removing the guard/interceptor returns `apps/api` to its
current (unauthenticated) state rather than a broken one. No production data exists at
this milestone, so there is no data-loss exposure.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-30 — single realm + attribute.** Realm/tenant model: single
   Keycloak realm + `tenant_id` custom user attribute (mapped into the JWT via a
   protocol mapper), not realm-per-tenant. Matches the shared-schema-plus-RLS default
   isolation tier M1 already built; avoids per-tenant IdP operational overhead this
   early; a specific large tenant can still be escalated to its own realm later as a
   deliberate future ADR, mirroring the dedicated-schema/dedicated-database DB tiers the
   `rls-multi-tenancy` Skill already lists as "not yet covered." Recorded as
   **ADR-0009** (Status: proposed — moves to accepted once implemented and its
   acceptance criteria are verified for real, same as this repo's other ADRs).
2. **RESOLVED 2026-07-30 — `SET LOCAL` per-request transaction.** RLS tenant-context
   binding under connection pooling uses `SET LOCAL app.tenant_id` inside a transaction
   wrapping each request, not session-level `set_config` or a dedicated per-tenant pool
   partition. The standard, well-understood Postgres-safe pattern for RLS-plus-pooling;
   requires no new pooling infrastructure; fails *closed* (an omitted `SET LOCAL` means
   the query sees no rows under any policy that filters on it, not the wrong tenant's
   rows) rather than failing open — now also codified as an explicit fail-closed test
   requirement (§8 item 6), not just a property asserted in prose. Recorded as
   **ADR-0010** (Status: proposed).
3. **RESOLVED 2026-07-30 — confirmed.** Org/branch selection is out of scope for
   FEAT-008. This proposal delivers login/guard/RLS-bind/web-session only; org/branch
   switching remains TASK-036's job (FEAT-010).

**Approved 2026-07-30** — full FEAT-008 scope, all three open questions resolved with
the recommended option in each case. TASK-028 may proceed; TASK-029/030/031 follow
under this same approval per §1's stated sequencing (028 → 029 → 030, with 031
parallel-eligible against 029 per its own Dependencies field).
