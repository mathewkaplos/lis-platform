# Implementation Proposal: Session token bridge (retain + refresh access/refresh tokens)
Status: APPROVED
ADR: ADR-0014 (accepted 2026-08-02 — the mechanism this proposal implements)
Date: 2026-08-02    Backlog ID: #265 (prerequisite for TASK-040, FEAT-011)

## 1. Goal

Found while planning TASK-040 (#99, FEAT-011): `apps/web` has no way to call `apps/api` at all —
its session discards the real Keycloak `access_token`/`refresh_token` at login. Raised to the human
directly (2026-08-02) rather than silently building it into TASK-040's own proposal, since this is
cross-cutting (every future frontend feature calling `apps/api` needs it), resolved as **ADR-0014**.
This proposal implements that ADR as its own standalone, reviewable unit — no registration-form UI
work happens here; see §1's own "why a separate PR" reasoning already recorded in ADR-0014 and
issue #265.

## 2. Affected files

- `apps/web/auth/session.ts` — `SessionPayload` gains `accessToken: string`, `refreshToken: string`,
  `accessTokenExpiresAt: number` (epoch seconds). `signSession`/`verifySession` extended to
  carry/validate the three new fields the same way the existing four are handled.
- `apps/web/app/api/auth/callback/route.ts` — populates the three new fields from the real
  `tokens` response (`tokens.access_token`, `tokens.refresh_token`,
  `Math.floor(Date.now() / 1000) + (tokens.expiresIn() ?? 0)`) instead of discarding them.
- `apps/web/auth/access-token.ts` (new) — `getValidAccessToken()`: reads the current session via
  `getSession()`; if absent, returns `undefined` (caller's own responsibility to redirect to login,
  same as every existing authenticated route today); if `accessTokenExpiresAt` is within a 30s
  buffer of now, calls `client.refreshTokenGrant(config, session.refreshToken)`, re-signs the
  session with the refreshed values, writes the updated cookie via `cookies().set(...)`, and returns
  the (possibly refreshed) access token. Only callable from a Server Action/Route Handler context
  (ADR-0014 §3) — the Next.js constraint that mutating cookies isn't permitted during a plain
  Server Component render.
- `apps/web/test/access-token.spec.ts` (new, or equivalent unit-test location matching this repo's
  existing `apps/web` test conventions once confirmed — see §4) — proves the refresh path fires
  when `accessTokenExpiresAt` is in the past/near-future and is skipped when the token is still
  fresh, without needing a real 5-minute wait.

## 3. Architecture consulted

- **ADR-0014** — the decision this proposal implements; see its own Context/Decision for the full
  reasoning (discarded tokens, the 5-minute/30-minute mismatch, the refresh mechanism, the
  Server-Action-only constraint).
- **`apps/web/app/api/auth/callback/route.ts`** (existing) — the exact shape `tokens` already has
  (confirmed directly: `client.authorizationCodeGrant` already returns `access_token`/
  `refresh_token`/`expiresIn()`; nothing new needs fetching, only retaining what's already there).
- **`apps/web/auth/session.ts`** (existing) — `signSession`/`verifySession`'s existing shape,
  extended in place, same HS256/audience-checked JWT mechanism, not a new session technology.
- **`openid-client` v6 docs** (Context7, this session) — `refreshTokenGrant(config, refreshToken,
  parameters?)` returns a full new `TokenEndpointResponse` (new `access_token`, and a `refresh_token`
  if the server rotates it — always store whatever comes back, per ADR-0014 §4); `.expiresIn()`
  helper gives remaining seconds directly, matching the same helper already available on the
  callback route's own `tokens` object.
- **`infra/keycloak/lis-realm.json`** — confirmed directly: `accessTokenLifespan: 300`,
  `lis-web` client is `publicClient: true` with `standardFlowEnabled` (PKCE) — refresh tokens are
  already issued on the standard authorization-code grant, no `offline_access` scope needed.
- **Real token sizes measured this session** (via a real password-grant token fetch against the
  local Keycloak): `access_token` ~934 bytes, `refresh_token` ~617 bytes — confirms ADR-0014's
  acceptance criterion that the resulting cookie stays comfortably under the ~4KB browser limit.

## 4. Skills loaded

- `authentication` Skill — loaded in full; no existing entry covers token retention/refresh
  specifically (this proposal's own work becomes its next real content, per AGENTS.md's same-day
  Skill-extension rule, once implemented — see §6).
- Checked `apps/web`'s existing test setup (`vitest.config.ts` if present) to match whatever unit
  test convention already exists there, rather than inventing a new one — confirmed at
  implementation time (§8), not assumed here.

## 5. Assumptions & autonomous decisions

- **`getValidAccessToken()` returns `undefined` (not a thrown error) when there is no session at
  all** — callers already have an established pattern for handling "no session" (every existing
  authenticated page checks `getSession()`'s own possible `undefined`); this mirrors that, rather
  than introducing a new error-handling convention for this one helper.
- **A refresh failure (expired refresh token, revoked session, Keycloak unreachable) clears the
  session cookie and returns `undefined`**, forcing the caller down the same "not authenticated"
  path as no session at all — matches `callback/route.ts`'s own existing fail-closed posture for a
  failed authorization-code exchange (ADR-0014 §Consequences), not a new posture invented here.
- **KB-09's refresh-token rotation/reuse-detection claim is not verified against the actual realm
  config by this proposal** — explicitly out of scope, per ADR-0014 §Decision 5. This proposal's own
  code correctly stores whatever `refresh_token` Keycloak returns each time; whether the realm
  itself enforces one-time-use + reuse-detection is a separate, standing gap, not silently assumed
  handled.

## 6. Risks

- **First refresh-token handling code in this repo** — no existing precedent to mirror beyond the
  callback route's own one-time exchange. Mitigated by keeping the helper narrowly scoped (one
  function, one responsibility) and testing the actual refresh path directly (§8), not just
  trusting the design.
- **A subtle Next.js constraint**: calling `cookies().set(...)` outside a Server Action/Route
  Handler either throws or silently no-ops depending on Next.js version/context — verified directly
  against this repo's actual Next.js version at implementation time, not assumed from general
  Next.js knowledge, given how version-sensitive this specific behavior has been across Next.js
  releases.
- **`authentication` Skill has no prior entry on token refresh** — this task's real implementation
  findings become its first content here, per AGENTS.md's same-day rule, not invented speculatively
  in this proposal.

## 7. Acceptance criteria

Per issue #265 / ADR-0014's own acceptance criteria:
- [ ] `callback/route.ts` populates `accessToken`/`refreshToken`/`accessTokenExpiresAt` from the
  real token response.
- [ ] `getValidAccessToken()` exists, refreshes when stale, re-persists the cookie.
- [ ] A real test proves a call succeeds past the 5-minute access-token lifespan without forcing a
  fresh login (via a fake/forced-stale `accessTokenExpiresAt`, not an actual 5-minute wait).
- [ ] No code path reads the tokens from the session directly to call `apps/api` — always through
  `getValidAccessToken()`.

## 8. Testing plan

1. `pnpm --filter web typecheck`/`lint` with the extended `SessionPayload` and the new helper.
2. A real test forcing `accessTokenExpiresAt` into the past for a real, valid session (constructed
   via `signSession` directly, not a live login) and confirming `getValidAccessToken()` calls
   `refreshTokenGrant` and returns a new, real access token — verified against the actual local
   Keycloak, not a mocked OIDC response (matching this repo's own "verify against the real thing"
   standard already established by every `apps/api` e2e spec).
3. A second case confirming `getValidAccessToken()` does *not* call `refreshTokenGrant` when the
   token is still comfortably valid — proving the buffer logic doesn't over-refresh on every call.
4. A manual, real end-to-end check: log in via the browser, wait past 5 minutes (or force
   `accessTokenExpiresAt` stale via a debug hook removed before merge), confirm a subsequent
   authenticated action still works without a forced re-login.
5. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive to `SessionPayload`/`callback/route.ts` (existing fields untouched, three new ones added)
and a new standalone helper file — no existing route or table changes. Rollback is reverting the
PR: the three new `SessionPayload` fields and `access-token.ts` are removed; `callback/route.ts`
reverts to discarding `access_token`/`refresh_token` as it does today. No production data or
deployed feature depends on this yet (TASK-040, the first real consumer, hasn't merged).

## 10. Questions requiring human approval

Both of this proposal's real open questions were already resolved directly, before drafting (per
Rule #0, given their cross-cutting/precedent-setting nature) — see ADR-0014:
1. **RESOLVED 2026-08-02 — store + auto-refresh both tokens.** Not the "access-token-only" MVP,
   given the near-certain 401-after-5-minutes regression that option would cause.
2. **RESOLVED 2026-08-02 — separate prerequisite PR**, not folded into TASK-040.

**No further questions — implementation begins now.**
