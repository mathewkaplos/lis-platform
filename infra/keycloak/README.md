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
- **`lis-web` only has the custom `tenant` client scope, not Keycloak's built-in
  `web-origins`/`profile`/`roles` scopes.** A hand-authored partial realm import does
  not auto-provision Keycloak's built-in scopes the way creating a realm through the
  admin console does (confirmed directly: referencing them by name in
  `defaultClientScopes` without defining them produced `Referenced client scope ...
  doesn't exist. Ignoring` on import). Since realm roles are deliberately not modeled
  yet (see above) and CORS/`web-origins` enforcement isn't exercised by any AC until
  TASK-031 (web login), these are left out now rather than defined speculatively —
  add them properly (with real protocol-mapper definitions, not just a name reference)
  when TASK-031 actually needs browser-origin enforcement.
- **The seeded `test-user`'s `tenant_id` attribute is the existing fixed seed tenant**
  (`00000000-0000-0000-0000-000000000001`) already used throughout
  `db/seed/chemistry-catalog.sql`, `rls-isolation-check.ts`, and
  `golden-dataset-check.ts` — so tokens issued for this user compose with existing seed
  data.

## Local dev

`test-user`'s password is the literal `test-password`, hardcoded in this file — same
convention `docker-compose.yml` already uses for its plain-text local `POSTGRES_PASSWORD`
(dev-only, ephemeral container, never exposed). Do not reuse this realm file as-is for
staging/production; a real deployment needs its own user provisioning, not a
checked-in test password.
