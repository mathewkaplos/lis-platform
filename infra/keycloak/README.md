# Keycloak realm config (TASK-028, FEAT-008)

`lis-realm.json` is the single source of truth for the `lis` realm — imported on
container start (`--import-realm`), never hand-edited in a running instance. Change
this file, re-import, same discipline as this repo's migrations ("never edited after
the fact"; here, "never configured out-of-band").

## Deliberate scope decisions

- **One realm (`lis`) for every tenant**, `tenant_id` carried as a per-user attribute
  and mapped into the `tenant_id` token claim by the `tenant` client scope. See
  ADR-0009.
- **No realm roles are defined here.** TASK-028's own AC is limited to token issuance
  ("a test user can obtain a valid token against the configured realm"); the actual
  RBAC+ABAC capability model (`enter_result`/`verify`/`signing_authority`-per-discipline,
  etc.) is specified in KB-10 (Authorization) and belongs to FEAT-009 (Authorization &
  audit) — a later M2 feature. Inventing role names here would risk conflicting with
  that not-yet-designed model; deferred deliberately, not an oversight.
- **`lis-web` is a public client** (Authorization Code + PKCE, no client secret) per
  KB-09's OAuth 2.1 framing. `directAccessGrantsEnabled: true` is turned on *only* so
  TASK-028's own AC and CI/dev verification scripts can request a token directly for a
  test user without a full browser round-trip — real user login (TASK-031) always uses
  the Authorization Code + PKCE flow, never this grant.
- **`lis-web`'s default scopes are exactly `tenant`, `openid`, and `basic` — not
  Keycloak's full built-in set (`web-origins`/`profile`/`roles`/etc.).** A
  hand-authored partial realm import does not auto-provision Keycloak's built-in
  scopes the way creating a realm through the admin console does: referencing any
  built-in scope by name in `defaultClientScopes` without also defining it produces
  `Referenced client scope ... doesn't exist. Ignoring` on import (confirmed directly,
  TASK-028) — and simply omitting a scope produces no warning at all, so a missing
  scope is silent until something downstream notices the missing claim.
  - **`openid` and `basic` are not optional decorations — TASK-029 needed them for
    real.** The token this realm originally issued had `"scope": "tenant"` only, no
    `sub` claim at all — `apps/api`'s auth guard (TASK-029) correctly rejected every
    token as a result, since it can't resolve "which user" without `sub`. Root cause,
    confirmed by comparing against a realm created via Keycloak's own Admin REST API
    (which fills in every default automatically) rather than guessed: `sub` is not
    hardcoded into every access token — it comes from the built-in `basic` scope's
    `oidc-sub-mapper` protocol mapper, and Keycloak only actually treats a client as a
    normal OIDC client (governing which core claims apply) once `openid` is an
    explicitly present scope. Neither is auto-added by a hand-authored import, same as
    the `web-origins`/`profile`/`roles` finding above — so both are now defined here
    in full (matching the Admin-API-created realm's real `basic`/`openid` scope
    definitions exactly, not approximated) and granted as default scopes.
  - `web-origins`/`profile`/`roles` remain deliberately omitted, confirmed still correct
    as of TASK-031: `apps/web`'s login/callback/logout routes only ever talk to
    Keycloak server-side (Next.js Route Handlers doing discovery/token-exchange/
    end-session over plain server-to-server HTTP), never via browser JS `fetch`/XHR —
    the standard OIDC BFF pattern this feature uses specifically to keep the raw
    Keycloak token out of browser JS. `web-origins` only matters for a client-side
    Keycloak adapter making cross-origin browser requests, which does not exist here.
    If a future task adds one (e.g. silent SSO via an iframe), define `web-origins` in
    full then, following the same discipline as `openid`/`basic` below — not a name
    reference.
  - **`post.logout.redirect.uris: "+"` added on `lis-web` (TASK-031).** Keycloak 19+
    requires a client's post-logout redirect URIs to be explicitly configured — it does
    not fall back to `redirectUris` the way login redirects do. `"+"` is Keycloak's own
    documented shorthand for "same set as Valid Redirect URIs," confirmed against
    Keycloak's own release notes rather than guessed. Without this, RP-Initiated
    Logout (`/api/auth/logout`) would fail with an `invalid redirect_uri` error page
    instead of completing.
- **The seeded `test-user`'s `tenant_id` attribute is the existing fixed seed tenant**
  (`00000000-0000-0000-0000-000000000001`) already used throughout
  `db/seed/chemistry-catalog.sql`, `rls-isolation-check.ts`, and
  `golden-dataset-check.ts` — so tokens issued for this user compose with existing seed
  data.
- **A second user, `test-user-2`, carries `tenant_id`
  `00000000-0000-0000-0000-000000000002`** — TASK-030's addition, reusing
  `rls-isolation-check.ts`'s existing `TENANT_B` convention rather than inventing a new
  UUID. Exists solely so TASK-030's cross-tenant isolation proof can be exercised
  through the live API with two real, differently-tenanted tokens, not just one —
  nothing seeds real data against this tenant; its only job is to prove it sees zero
  rows of `test-user`'s tenant's data.

## Local dev

`test-user`'s password is the literal `test-password`, hardcoded in this file — same
convention `docker-compose.yml` already uses for its plain-text local `POSTGRES_PASSWORD`
(dev-only, ephemeral container, never exposed). Do not reuse this realm file as-is for
staging/production; a real deployment needs its own user provisioning, not a
checked-in test password.
