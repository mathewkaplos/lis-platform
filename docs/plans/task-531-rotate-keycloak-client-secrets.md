# Implementation Proposal: Rotate checked-in dev-only Keycloak client secrets out of real staging
Status: IMPLEMENTED
ADR: none (no existing ADR covers machine-client secret provisioning)    Date: 2026-08-15    Backlog ID: issue #531 (lis-platform)

**Approved 2026-08-15** via the native options-prompt. §10 answered: scope is
`lis-platform-analytics` + `lis-onboarding` (not gateway/interop, since neither is deployed to
staging yet); secret values self-generated via `openssl rand`, set via `gh secret set`; lands as
its own standalone PR, same merge/verify flow as PR #587 earlier this session.

**Implemented 2026-08-15, PR #588, verified live on the real droplet — not just CI-green:**
- Deploy log confirms both PUTs succeeded: `lis-onboarding secret PUT: HTTP 204`,
  `lis-platform-analytics secret PUT: HTTP 204`.
- Direct verification against real staging Keycloak (`157.230.10.221`): a client-credentials grant
  with the OLD checked-in placeholder now gets `401 unauthorized_client`; the same grant with the
  new value `api`'s own `ONBOARDING_CLIENT_SECRET` env var actually holds gets `200` with a real
  `access_token` — proving Keycloak and `apps/api` agree on the new secret, not just that each was
  independently updated.
- Issue #531 auto-closed on merge (`Closes #531` in the PR body).

## 1. Goal

Close the gap issue #531 named for `lis-platform-analytics`: `infra/keycloak/lis-realm.json` is
this repo's single source of truth for realm/client config, shared across local dev, CI, *and*
staging — `deploy-staging.yml` imports it into the real staging Keycloak verbatim (`jq 'del(.users)'`
strips only the test users, nothing else) on every deploy. Every machine service-account client's
`secret` field is a checked-in, publicly-visible placeholder (`dev-only-lis-<name>-secret`), and
nothing in the staging pipeline overrides it — unlike `lis_app`'s DB password, which *is* rotated
via `ALTER ROLE ... WITH PASSWORD '$LIS_APP_DB_PASSWORD'` in `deploy-staging.yml` already.

**A more urgent, live instance of the identical gap was found during investigation, not named by
#531 itself:** `apps/api/src/onboarding/keycloak-admin-auth.service.ts` (FEAT-049, ADR-0040) reads
`ONBOARDING_CLIENT_SECRET` from env, falling back to the literal checked-in placeholder
(`dev-only-lis-onboarding-secret`) when unset. `deploy-staging.yml`/`docker-compose.staging.yml`
set that env var nowhere. FEAT-049's self-service `/signup` flow is a real, already-shipped,
already-deployed feature — `apps/api` is running on staging right now. So unlike
`lis-platform-analytics` (which currently has **zero** live runtime consumers anywhere in this
repo — only test scripts hardcode its secret), `lis-onboarding`'s placeholder secret is not a
latent risk, it is the literal credential staging's real onboarding flow authenticates with today.

## 2. Affected files

- `.github/workflows/deploy-staging.yml` — new step, placed immediately after the existing
  `unmanagedAttributePolicy` GET → jq-merge → PUT block (same admin token already obtained there,
  same "warn and continue, don't hard-fail the deploy" idiom already established for that block).
  For each in-scope client: `GET /admin/realms/lis/clients?clientId=<id>` to resolve its Keycloak
  UUID, then `PUT /admin/realms/lis/clients/<uuid>` with the full representation, `secret`
  overridden to the real value from a repo secret.
- `infra/docker-compose.staging.yml` — wire the new secret(s) into `api`'s `environment:` block
  (and `gateway`/`interop`'s, if/when those services are ever deployed to staging — see §10),
  mirroring `APP_DATABASE_URL`'s existing pattern exactly.
- New GitHub repo secret(s) — see §10 for which.
- `~/work/lis-engineering/skills/engineering/authentication/SKILL.md` — new entry: this is a
  second instance of entry #10's "live-only, realm-JSON-file-unbacked change" class (a client-secret
  PUT instead of a User Profile PUT, same must-reapply-every-deploy shape, same root cause —
  Keycloak is fully rebuilt from `lis-realm.json` every deploy per entry #8). Also cross-references
  `docker-pnpm-monorepo-deploy` Skill entry #25 ("three surfaces") — the same class of gap, now
  found for a Keycloak client secret rather than a plain `requiredEnv()` var.

## 3. Architecture consulted

- `engineering/authentication` Skill entries #8 and #10 — Keycloak has no persisted volume on
  staging and is rebuilt fresh from `lis-realm.json` every deploy; any live-only Admin API change
  (the User Profile fix) must be reapplied every deploy, not once. This proposal's rotation step is
  the same shape.
- `deploy-staging.yml`'s existing `ALTER ROLE lis_app WITH PASSWORD '$LIS_APP_DB_PASSWORD'` +
  `LIS_APP_DB_PASSWORD` secret — the direct precedent issue #531 itself names for how this should
  work.
- `deploy-staging.yml`'s existing `unmanagedAttributePolicy` GET→jq-merge→PUT idiom against the
  Keycloak Admin API (lines ~424-436) — identical idiom, different endpoint/field.
- `docker-pnpm-monorepo-deploy` Skill entry #25 ("three surfaces": local `.env`/CI `pr.yml`/staging
  compose+deploy-workflow must all agree on an env var — this repo has no automated cross-check).
- ADR-0040 (`lis-onboarding`, FEAT-049), ADR-0048/FEAT-056 (`lis-platform-analytics`).

## 4. Skills loaded

`engineering/authentication` (Keycloak realm-import conventions, live-vs-import-time write
semantics), `docker-pnpm-monorepo-deploy` (staging deploy pipeline shape, the "three surfaces" env
var lesson).

## 5. Assumptions & autonomous decisions

- **Rotation mechanism:** use `GET .../clients?clientId=X` → `PUT .../clients/{uuid}` with `secret`
  overridden (full representation PUT), **not** Keycloak's `POST .../clients/{id}/client-secret`
  regenerate endpoint — that endpoint generates a random value server-side with no way to pin it,
  and the same value must exist in both Keycloak and the consuming service's own env var.
- `apps/gateway` and `apps/interop` are confirmed **not** currently deployed to staging (no service
  block in `docker-compose.staging.yml`) — rotating their Keycloak-side secret now is cheap (one
  more loop iteration, one more repo secret) but has no live consumer to match it against yet.
  Not assumed either way — surfaced as a scope question in §10 rather than decided unilaterally,
  per this task's own explicit instruction.
- Test scripts (`get-platform-analytics-token.ts`, `get-gateway-token.ts`, `get-interop-token.ts`)
  keep using their hardcoded dev-only secret literals unchanged — they only ever run against
  local/CI Keycloak, which keeps importing `lis-realm.json`'s placeholders unmodified; this
  proposal only changes what happens on the real staging import.

## 6. Risks

- If the new deploy step fails or is skipped (Keycloak's admin API not ready in time — a known,
  already-tolerated race per the existing `unmanagedAttributePolicy` block's own
  `WARNING: ... skipping ... this deploy` pattern), the affected client silently falls back to the
  checked-in placeholder for that one deploy. Same tolerated-degradation shape already accepted for
  the User Profile fix — not a new risk class this proposal introduces.
- `KeycloakAdminAuthService` caches its token in-memory (`TokenCache`) for its own lifetime; the
  moment the secret rotates, any in-flight cached token keeps working until its own expiry, then the
  *next* refresh needs the new env var — which the same deploy that rotates the secret also
  naturally supplies, since `api` gets a fresh container every deploy regardless.
- Scope entirely limited to machine-to-machine service-account credential hygiene — no Constitution
  Law (#1-#5) is implicated; no clinical/PHI data path touches this change.

## 7. Acceptance criteria

- `infra/keycloak/lis-realm.json`'s checked-in secrets remain unchanged (still needed as-is for
  local dev/CI, which never touch a real environment) — they are simply no longer what real staging
  Keycloak actually accepts after this deploy step runs.
- A client-credentials grant against real staging Keycloak using the OLD placeholder secret is
  rejected (`invalid_client`); the same grant using the new repo-secret value succeeds.
- For any in-scope client with a live consumer (`lis-onboarding` at minimum): that consumer's real
  flow round-trips end-to-end on staging using the new secret (e.g., a real `/signup` create-user
  call for `lis-onboarding`).

## 8. Testing plan

- Local/CI: unaffected by design — `lis-realm.json`'s placeholders remain the source of truth there.
- Staging: after the next deploy, directly verify (SSH access to the droplet already confirmed
  working this session) — both the rejected-old-secret and accepted-new-secret grants above, plus
  the live consumer's real flow for whichever client(s) have one.

## 9. Rollback plan

Revert the `deploy-staging.yml`/`docker-compose.staging.yml` diff. The next deploy re-imports
`lis-realm.json`'s original placeholder secrets with no PUT override, returning to the prior
(insecure, but known) state. Purely stateless credential config — no data migration, no schema
change, nothing to undo on the Postgres side.

## 10. Questions requiring human approval — ANSWERED

1. **Scope** — **`lis-platform-analytics` + `lis-onboarding`.** `lis-gateway`/`lis-interop`
   deliberately excluded (same mechanism will apply cleanly whenever either is actually deployed
   to staging — not before, since there's no live consumer to verify against yet).
2. **Secret values** — self-generated via `openssl rand`, set via `gh secret set`, same as
   `MINIO_ROOT_PASSWORD` earlier this session. Never displayed in chat, never written to a file.
3. **Landing** — own standalone PR, same merge → verify-on-the-real-droplet flow as PR #587.
