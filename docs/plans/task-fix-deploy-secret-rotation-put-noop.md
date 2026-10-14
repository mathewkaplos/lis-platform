# Implementation Proposal: Fix deploy-staging.yml's no-op client-secret rotation
Status: APPROVED
ADR: n/a    Date: 2026-10-14    Backlog ID: n/a (found during task-fix-onboarding-keycloak-admin-url's live verification)

## 1. Goal

`.github/workflows/deploy-staging.yml` (task-531, lines ~462-504) tries to keep two Keycloak
clients' secrets (`lis-onboarding`, `lis-platform-analytics`) pinned to their GitHub repo-secret
values (`ONBOARDING_CLIENT_SECRET`, `PLATFORM_ANALYTICS_CLIENT_SECRET`) on every deploy, via a
GET-full-representation → merge `secret` → PUT-full-representation sequence. **Confirmed live
against the real `lis-staging` droplet, repeatedly, across multiple Keycloak recreates this
session: this PUT returns `204` and the GET-based client-secret-length endpoint reflects the new
value, but the credential Keycloak actually validates against for `client_credentials`/`password`
grants does not change.** Only the dedicated `POST .../clients/{id}/client-secret` (regenerate)
endpoint actually updates the auth-usable secret — confirmed by using it directly and getting an
immediate, real `200` on a token request that had been `401 unauthorized_client` moments before
with the PUT-based value in place.

Net effect: both `lis-onboarding` (`apps/api/src/onboarding/**`, real user-creation writes,
ADR-0040) and `lis-platform-analytics` (`apps/api/src/auth/capabilities.ts`,
`apps/api/test/get-platform-analytics-token.ts`) silently run on whatever secret was baked into
`infra/keycloak/lis-realm.json` at realm-import time (the checked-in dev-only placeholder) rather
than the real repo-secret value `apps/api`'s own `.env` is configured with — on every single
deploy, since Keycloak has no persisted volume and re-imports the realm fresh every time
(`docker compose rm -f -s keycloak` + `--import-realm`, same comment this workflow already has
elsewhere). This is why `POST /v1/users` was 500ing with `401 invalid_client_credentials` for
what may have been this feature's entire real-staging lifetime (ADR-0040's own comment: "the
first live write" this code has ever attempted against non-CI Keycloak) — a separate, deeper bug
than task-fix-onboarding-keycloak-admin-url's `405` routing issue, uncovered only after that one
was fixed and this one became the new blocker.

## 2. Affected files

- `.github/workflows/deploy-staging.yml` — the `CLIENT_PAIR` loop (lines ~482-504): replace the
  PUT-based "pin to repo secret" approach entirely.
- Whatever file currently generates `.env` on the droplet from this job (same job, earlier
  `cat > .env <<'ENVEOF'` section around line 239) — needs to write whatever secret value the new
  mechanism actually produces, not read `ONBOARDING_CLIENT_SECRET`/`PLATFORM_ANALYTICS_CLIENT_SECRET`
  as static repo secrets anymore (see §3).
- GitHub repo secrets `ONBOARDING_CLIENT_SECRET`/`PLATFORM_ANALYTICS_CLIENT_SECRET` — likely
  retired entirely if §3's regenerate-and-read-back approach is adopted (no longer a human-chosen
  pinned value, Keycloak generates it fresh each deploy).

## 3. Proposed fix

Stop trying to pin a chosen secret value into Keycloak (the thing the PUT approach was for, and
the thing that silently doesn't work). Instead, make Keycloak the source of truth each deploy:

1. Call `POST .../clients/{id}/client-secret` (regenerate) for each client — confirmed live this
   actually updates the auth-usable credential.
2. Read back the new value via `GET .../clients/{id}/client-secret`.
3. Write *that* value into the `.env` this same job already generates for `api`, instead of
   substituting a static repo secret.

This removes the entire "pin a specific value" requirement that motivated avoiding the regenerate
endpoint in the first place (that reasoning is now known to be moot, since the PUT alternative it
was avoiding doesn't actually work) — and removes a whole class of secret-drift bug, since the
live Keycloak and `api`'s own env can never disagree: every deploy, `api` gets told whatever
Keycloak's current real secret actually is, rather than a value that's supposed to match but
silently doesn't.

Alternative considered and rejected: keep investigating *why* the full-representation PUT doesn't
take effect (possible Keycloak-version-specific behavior, a caching layer, or a known Keycloak
quirk where `secret` must be set via the dedicated endpoint). Rejected because even if root-caused,
the regenerate-and-read-back approach is simpler, already proven to work, and removes a category
of future drift risk (a human-rotated repo secret getting out of sync with what's pinned) that the
PUT approach was inherently exposed to even when working as intended.

## 4. Risks

- `ONBOARDING_CLIENT_SECRET`/`PLATFORM_ANALYTICS_CLIENT_SECRET` repo secrets become unused by this
  mechanism — confirm nothing else in the repo (another workflow, a local-dev script) still reads
  them expecting a stable value, before removing them from GitHub's secret store.
- `apps/api/test/get-platform-analytics-token.ts` (a manual verification script, not CI) likely
  assumes a known, stable `PLATFORM_ANALYTICS_CLIENT_SECRET` — check whether it needs updating to
  fetch the live value from the droplet instead, or whether it's local-dev-only (where the realm's
  checked-in placeholder secret is fine, unaffected by this staging-only workflow change).
- Low overall risk: fixes a feature currently 100% broken on real staging, no working behavior to
  regress.

## 5. Acceptance criteria

- A full normal deploy (push to `main`) leaves `lis-onboarding`'s live Keycloak secret matching
  exactly what `api`'s own `.env` has — verified via the same byte-level (length + checksum)
  comparison technique used live this session, never printing the actual secret value in any
  log/output.
- `POST /v1/users` succeeds end-to-end against real staging immediately after a normal deploy,
  with no manual intervention (unlike today, where it required a live, manual regenerate-and-sync
  dance after every Keycloak recreate).
- `lis-platform-analytics` gets the same fix (not just `lis-onboarding`) — same bug, same root
  cause, same loop in the workflow.

## 6. Testing plan

- Live-verify against the real droplet after a real deploy triggers this new logic — this bug
  class is fundamentally only observable against real (non-CI-ephemeral) Keycloak, same as
  task-fix-onboarding-keycloak-admin-url.
- Confirm CI's own `pr.yml` path is unaffected — it doesn't run this deploy-staging.yml logic at
  all, so this change has zero CI blast radius by construction.

## 7. Rollback plan

Revert to the PUT-based loop. No regression risk either direction — today's behavior is "secret
rotation silently doesn't work," so any revert returns to that same already-broken state, not a
worse one.

## 8. Questions — resolved 2026-10-14

1. Approved: `ONBOARDING_CLIENT_SECRET`/`PLATFORM_ANALYTICS_CLIENT_SECRET` are retired as GitHub
   repo secrets (no longer read anywhere in this mechanism) — nothing else in the repo depends on
   predicting their value in advance.
2. Checked: `apps/api/test/get-platform-analytics-token.ts` hardcodes the realm's own checked-in
   placeholder secret directly and talks to local/CI Keycloak only — entirely unaffected by this
   change, no update needed.

## 9. Implementation log

Implemented 2026-10-14 in `.github/workflows/deploy-staging.yml`:
- Removed both `*_CLIENT_SECRET=${{ secrets.* }}` lines from the `.env` heredoc.
- Replaced the `CLIENT_PAIR` loop's GET-full-representation/PUT-merge sequence with: resolve
  client UUID → `POST .../client-secret` (regenerate) → append the real returned value directly to
  `.env` as `ONBOARDING_CLIENT_SECRET`/`PLATFORM_ANALYTICS_CLIENT_SECRET`. Same non-fatal-on-
  failure shape as before (`continue` + a `WARNING:` on any step failing).
- `docker compose up -d api web` (unchanged, already runs after this block) now picks up whatever
  real secret Keycloak just generated, since `.env` has it by the time compose reads it.
