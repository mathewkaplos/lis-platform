# FEAT-009 (#18) staging verification — proven runbook

Fully dry-run and proven working end-to-end against a clean local Docker
Compose stack (`docker compose down -v && docker compose up -d && pnpm
db:reset`) before being adapted here for staging's real addressing. Every
command below produced real, verified output locally (201 / 403 / audit
chain `{"valid":true}`) — nothing in this file is inferred or untested logic.

Copy-paste each block below into the staging droplet console
(`cloud.digitalocean.com` → Droplets → `lis-staging` → Access → Launch
Droplet Console — there is no personal SSH key for this box, see
`scripts/feat009-staging-verify.sh` for why) in order, checking output
before moving to the next block.

## What actually broke during local debugging, and why each fix below exists

1. **`KEYCLOAK_ADMIN_PASSWORD` isn't a droplet shell variable** — it only
   lives inside the running `keycloak` container's own environment. Fetch it
   from there, don't assume it's already exported.
2. **Users created with only `username`+`enabled` fail login** with
   `"Account is not fully set up"`. Root cause (confirmed by directly
   reproducing it locally: a PUT that dropped `firstName`/`lastName`/`email`
   immediately reproduced the exact same error): Keycloak's Resource Owner
   Password Credentials grant dynamically injects an `UPDATE_PROFILE`
   required action into the auth session — separate from the user's own
   *persisted* `requiredActions` list — whenever a required User Profile
   attribute is missing. Fix: always set `email`/`emailVerified`/`firstName`/
   `lastName` at user creation.
3. **`tenant_id` attribute silently doesn't stick, no error, HTTP 204 on the
   write, `kcadm get` shows nothing** — confirmed via a raw Admin REST API
   round-trip (bypassing `kcadm` entirely) that the write is genuinely
   dropped server-side, not a display quirk. Root cause: the `lis` realm's
   declarative User Profile schema (`GET
   /admin/realms/lis/users/profile`) only declares `username`/`email`/
   `firstName`/`lastName` as managed attributes. `tenant_id` isn't one of
   them, so Keycloak silently strips it from any live write (`kcadm`
   included) unless the profile's `unmanagedAttributePolicy` is `ENABLED`.
   The realm's four built-in `test-user*` accounts only have `tenant_id`
   because they were loaded via bulk realm **import** at container boot,
   which bypasses this validation layer entirely — a live admin write does
   not get the same bypass. Fix: enable unmanaged attributes on the realm's
   User Profile once, before setting any custom attribute on a new user.
4. **`curl -d` mangles passwords containing `+`** — `application/
   x-www-form-urlencoded` treats a literal `+` as a space, and plain `-d`
   does not percent-encode it. Use `--data-urlencode` everywhere a
   password/username is sent.
5. **`kcadm` admin sessions expire mid-run** — if any command below says
   `Session has expired. Login again with 'kcadm.sh config credentials'`,
   just re-run the login command from Step 1 and retry.

## Step 0 — Get the Keycloak admin session

```bash
export KEYCLOAK_ADMIN_PASSWORD=$(docker exec $(docker ps -qf name=keycloak) printenv KC_BOOTSTRAP_ADMIN_PASSWORD)

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD"
```

## Step 1 — Enable unmanaged attributes on the realm's User Profile (once)

This is what actually lets `tenant_id` persist on a live-created user. Without
this step, Step 2's `attributes.tenant_id` write below will silently no-op.

Keycloak is bound to the droplet's own `127.0.0.1:8080`
(`docker-compose.staging.yml`'s `ports: ["127.0.0.1:8080:8080"]`), so this
runs as plain `curl` on the droplet's host shell — no `docker exec`/`docker
run` wrapping needed, exactly as proven locally:

```bash
ADMIN_TOKEN=$(curl -sS --data-urlencode "grant_type=password" --data-urlencode "client_id=admin-cli" \
  --data-urlencode "username=admin" --data-urlencode "password=$KEYCLOAK_ADMIN_PASSWORD" \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" | jq -r .access_token)

PROFILE=$(curl -sS "http://localhost:8080/admin/realms/lis/users/profile" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

NEW_PROFILE=$(echo "$PROFILE" | jq '. + {unmanagedAttributePolicy: "ENABLED"}')

curl -sS -X PUT "http://localhost:8080/admin/realms/lis/users/profile" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "$NEW_PROFILE" -w "\nHTTP %{http_code}\n"
```

Expect `HTTP 200`. (`jq` is already confirmed present on this droplet — it
was used successfully in this same session's earlier token-fetch commands.)

## Step 2 — Provision the two throwaway users

```bash
export NEW_PASS="$(openssl rand -base64 24)"

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh create users \
  -r lis -s username=verify-demo-user -s enabled=true \
  -s email=verify-demo-user@example.invalid -s emailVerified=true \
  -s firstName=Verify -s lastName=DemoUser

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh set-password \
  -r lis --username verify-demo-user --new-password "$NEW_PASS" --temporary=false

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh add-roles \
  -r lis --uusername verify-demo-user --rolename verifier

VERIFY_ID=$(docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh get users -r lis \
  -q username=verify-demo-user --fields id --format csv --noquotes)

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh update users/$VERIFY_ID -r lis \
  -s 'attributes.tenant_id=["00000000-0000-0000-0000-000000000001"]'

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh create users \
  -r lis -s username=technologist-only-demo-user -s enabled=true \
  -s email=technologist-only-demo-user@example.invalid -s emailVerified=true \
  -s firstName=TechOnly -s lastName=DemoUser

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh set-password \
  -r lis --username technologist-only-demo-user --new-password "$NEW_PASS" --temporary=false

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh add-roles \
  -r lis --uusername technologist-only-demo-user --rolename technologist

TECH_ID=$(docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh get users -r lis \
  -q username=technologist-only-demo-user --fields id --format csv --noquotes)

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh update users/$TECH_ID -r lis \
  -s 'attributes.tenant_id=["00000000-0000-0000-0000-000000000001"]'
```

## Step 3 — Get tokens (external — tailnet reachable, doesn't need to run on the droplet)

```bash
TOKEN_VERIFIER=$(curl -sS --data-urlencode "grant_type=password" --data-urlencode "client_id=lis-web" \
  --data-urlencode "username=verify-demo-user" --data-urlencode "password=$NEW_PASS" \
  "https://lis-staging.taila0fbf9.ts.net:8443/realms/lis/protocol/openid-connect/token" | jq -r .access_token)

TOKEN_TECH_ONLY=$(curl -sS --data-urlencode "grant_type=password" --data-urlencode "client_id=lis-web" \
  --data-urlencode "username=technologist-only-demo-user" --data-urlencode "password=$NEW_PASS" \
  "https://lis-staging.taila0fbf9.ts.net:8443/realms/lis/protocol/openid-connect/token" | jq -r .access_token)

echo "verifier token: ${TOKEN_VERIFIER:0:20}..."
echo "tech-only token: ${TOKEN_TECH_ONLY:0:20}..."
```

Both must print a real (non-`null`) prefix before continuing.

## Step 4 — Exercise the capability-check + audit routes

`api` has no exposed port on staging at all — this must run on the droplet,
through a container on `lis_staging_net`:

```bash
echo "--- Positive case: verifier role -> expect 201 ---"
docker run --rm --network lis_staging_net curlimages/curl -sS -w "\nHTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN_VERIFIER" \
  http://api:4000/auth/capability-check/verify

echo
echo "--- Negative case: technologist-only role attempting :verify -> expect 403 ---"
docker run --rm --network lis_staging_net curlimages/curl -sS -w "\nHTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN_TECH_ONLY" \
  http://api:4000/auth/capability-check/verify

echo
echo "--- Audit trail: confirm hash chain still valid ---"
docker run --rm --network lis_staging_net curlimages/curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN_VERIFIER" \
  http://api:4000/auth/capability-check/audit-chain-valid
```

Expected, proven locally: `HTTP 201` with a `resourceId` and
`"actorRole":"verifier"` on the first call; `HTTP 403` with
`{"message":"No role grants the 'verify' capability", ...}` on the second;
`{"valid":true}` with `HTTP 200` on the third.

## Step 5 — Cleanup

Uses `$VERIFY_ID`/`$TECH_ID` from Step 2 — run in the same shell session:

```bash
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh delete users/$VERIFY_ID -r lis
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh delete users/$TECH_ID -r lis
```

**Leave the realm's `unmanagedAttributePolicy: ENABLED` change from Step 1
in place** — it's a one-time, non-destructive realm setting (it only widens
what admin writes are *allowed* to persist; it doesn't change anything about
existing users or mappers) and reverting it would just make the next
person's throwaway-user provisioning hit the exact same silent-drop wall
again. Worth eventually promoting into `infra/keycloak/lis-realm.json`
itself (a `userProfile` block) so it survives every realm re-import instead
of being a manual step at all — not done here since it's a repo change
outside this runbook's scope, flagged for a follow-up decision.

## Step 6 — Report results on #18

Once all three capability-check calls in Step 4 show the expected real
output, comment on #18 with that evidence (same pattern as #232/#17):
verifier allowed (201), technologist-only refused (403), audit chain valid.
