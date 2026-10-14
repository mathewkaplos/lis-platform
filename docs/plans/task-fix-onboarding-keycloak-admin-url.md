# Implementation Proposal: Fix onboarding's Keycloak admin-API URL construction
Status: APPROVED
ADR: n/a    Date: 2026-10-14    Backlog ID: n/a (found via live load-testing, this session)

## 1. Goal

`POST /v1/users` (the only live-write user-onboarding path, `apps/api/src/onboarding/keycloak-user.service.ts`,
ADR-0040) is structurally broken as of the `lis-staging` droplet's domain migration
(`docs/plans/task-persistent-public-domain-access-lis-staging.md`, 2026-10-12): every call 500s.

Root cause, confirmed live against the real droplet, not guessed:
`KeycloakUserService.adminBaseUrl` derives the Admin REST API's base URL from
`KEYCLOAK_ISSUER_URL` (`.replace('/realms/', '/admin/realms/')`). Since that env var is now the
**public** domain (`https://lis-staging.duckdns.org/realms/lis`), the derived admin URL is
`https://lis-staging.duckdns.org/admin/realms/lis`. That request goes out over the real internet,
through Caddy, into `infra/nginx-public.conf` — which deliberately proxies only `/realms/` and
`/resources/` to Keycloak (its own comment: "never `/admin`, which stays reachable only via the
existing `127.0.0.1:8080` binding" — a correct security boundary). `/admin/*` falls through to the
catch-all `location /` block and is proxied to `apps/web` instead, which has no such route and
returns `405`. `apps/api` surfaces this as a bare `500` ("Keycloak user creation failed: 405").

**No security exposure exists** — Keycloak's admin API genuinely is not reachable from outside,
exactly as `nginx-public.conf` intends. This is a functional regression only, not a vulnerability.

A second, since-fixed issue was found and corrected live on the droplet before this one: the
`lis-onboarding` Keycloak client's secret (used by `KeycloakAdminAuthService` to obtain the admin
token in the first place) had silently drifted from what `apps/api`'s own `.env` expects —
confirmed Keycloak's full-representation client `PUT` (what `deploy-staging.yml`'s own
secret-rotation step uses) updates the *displayed* client representation but does **not** update
the credential actually used for authentication; only the dedicated
`POST .../clients/{id}/client-secret` regenerate endpoint does. That's §2 below — a second,
separate real bug in `deploy-staging.yml` itself, not fixed by this proposal (scoped out, see §5).

## 2. Affected files

- `apps/api/src/onboarding/keycloak-user.service.ts` — `adminBaseUrl` getter: stop deriving from
  `KEYCLOAK_ISSUER_URL`; use a new, internal-only base URL instead.
- `apps/api/src/onboarding/keycloak-admin-auth.service.ts` — read first to confirm whether it has
  the *same* class of bug for the token-fetch call. Live evidence says the token fetch currently
  **works** through the public domain (confirmed: a direct `client_credentials` grant against
  `https://.../realms/lis/protocol/openid-connect/token` succeeded after the secret fix) — because
  `/realms/*` *is* proxied by `nginx-public.conf`. So this file likely does NOT need the same fix,
  but confirm by reading it rather than assuming symmetry with `keycloak-user.service.ts`.
- `infra/docker-compose.staging.yml` / `.github/workflows/deploy-staging.yml` — add whatever new
  env var this introduces (see §3) to `api`'s environment block and the deploy workflow's env
  generation, mirroring how `KEYCLOAK_ISSUER_URL` is already wired.
- `apps/api/.env.example` or equivalent, if this repo keeps one — document the new var.

## 3. Proposed fix

Introduce a new env var, internal-only, never derived from the public-facing issuer:
`KEYCLOAK_INTERNAL_ADMIN_URL`, defaulting to `http://keycloak:8080/admin/realms/lis` (matching the
existing `KEYCLOAK_ISSUER_URL` fallback's own `http://localhost:8080/realms/lis` convention for
local dev — i.e. `http://localhost:8080/admin/realms/lis` as the local-dev default).
`adminBaseUrl` becomes a direct read of this var (with that default), not a string transform of
the issuer URL. This mirrors the comment already in `oidc-config.ts` about `apps/web` needing a
server-side-reachable Keycloak URL distinct from the browser-facing one — the same architectural
gap, now surfacing in `apps/api`'s own admin-API caller.

Alternative considered and rejected: route `/admin/*` through `nginx-public.conf` to Keycloak.
Rejected because it would make Keycloak's admin API publicly reachable, a real new security
exposure to fix a routing convenience — the correct fix keeps the admin call entirely internal.

## 4. Separately-tracked finding (not fixed by this proposal)

`deploy-staging.yml`'s secret-rotation step (lines ~462-504, `#531`/task-531) uses a
full-representation client `PUT` to pin `lis-onboarding`'s secret to the `ONBOARDING_CLIENT_SECRET`
repo secret on every deploy. **Confirmed live this session: this PUT does not actually update the
credential Keycloak uses for authentication**, despite returning `204` and the GET-based
client-secret-length endpoint reporting the new value. Only
`POST .../clients/{id}/client-secret` (which generates a *random* value, not a pinned one — the
exact tradeoff that workflow's own comment says it was trying to avoid) actually works. This is
why `POST /v1/users` was failing with `401 invalid_client_credentials` for what may have been a
long time before this session's load-testing ever exercised it (ADR-0040's own comment: "the first
live write" this code has ever attempted against non-CI Keycloak). This needs its own, separate
Implementation Proposal — likely either (a) regenerate-and-read-back the secret on every deploy
and write *that* into `api`'s own env (abandoning "pinning" entirely), or (b) investigate why the
PUT doesn't take effect in this Keycloak version/config (possibly a caching layer, possibly a
Keycloak behavior change versus whatever version this mechanism was originally verified against).
Flagging here so it isn't lost; not in scope for the URL-construction fix above.

## 5. Risks

- Low — this is a narrowly-scoped env-var/URL-construction fix to a feature that is currently
  100% broken (every call 500s), so there's no working behavior to regress.
- The new env var needs to actually reach the `api` container in both the normal CI-managed
  tailnet deploy and any future redeploy — verify it's added to `docker-compose.staging.yml`'s
  `api` environment block, not just the local/dev default.

## 6. Acceptance criteria

- `POST /v1/users` (as `lab_admin`/`test-user-11` or equivalent) succeeds end-to-end against the
  real `lis-staging` droplet: live Keycloak user created, role assigned, response `2xx`.
- Confirm `KeycloakAdminAuthService`'s own token-fetch path is unaffected (still uses the public
  issuer URL, which is proxied correctly) — don't change it unless §2's "read first" step finds a
  real reason to.
- No change to `nginx-public.conf`'s deliberate `/admin/*` non-exposure.

## 7. Testing plan

- Live-verify against the real droplet (this repo's Rule #0 — "verify, don't guess," and this
  whole bug class only manifests against real infra, not local dev where `KEYCLOAK_ISSUER_URL`
  already points at `keycloak:8080`/`localhost:8080` internally with no public/internal split).
- Confirm CI's own `pr.yml` ephemeral-Keycloak path still passes (it should be completely
  unaffected — CI's `KEYCLOAK_ISSUER_URL` is already internal-only, so `adminBaseUrl`'s new default
  fallback behaves identically to today's derived value there).

## 8. Rollback plan

Revert the env var addition and the `adminBaseUrl` getter change; `POST /v1/users` returns to its
current (already fully broken) state — no regression risk either direction.

## 9. Questions — resolved 2026-10-14

1. **Env var name: `KEYCLOAK_INTERNAL_ADMIN_URL`**, as suggested.
2. §4's secret-rotation bug: left as a follow-up, not opened as a separate proposal in this pass.
