#!/usr/bin/env bash
#
# HOW TO RUN
# ----------
# This script does NOT execute anything against staging itself -- it only
# prints the runbook (step-by-step commands) to your terminal. That's
# deliberate: provisioning users and calling capability-check routes on a
# real, shared staging box shouldn't happen unattended. Copy-paste each
# step's printed commands into an actual session on the droplet, in order,
# checking the output before moving to the next step.
#
#   1. Print the runbook:
#        bash scripts/feat009-staging-verify.sh
#      (or just read the script -- the `cat <<EOF` blocks below are the
#      literal commands; running it just saves you re-typing them)
#
#   2. Get a shell on the staging droplet. There is no personal SSH key for
#      this box -- `deploy_key` in deploy-staging.yml is a GitHub Actions
#      secret (`secrets.DEPLOY_SSH_KEY`) written to disk only inside the CI
#      runner and deleted at the end of the job (deploy-staging.yml:71-72,
#      414); it's never available locally. The droplet also has no
#      `ssh_keys` configured in infra/main.tf. The access method this repo's
#      own comments actually use for manual work (docker-compose.staging.yml
#      and deploy-staging.yml both reference it after real incidents) is the
#      **DigitalOcean web console**:
#        cloud.digitalocean.com -> Droplets -> lis-staging -> Access ->
#        Launch Droplet Console
#      That opens a root shell in the browser, no key needed (DO account
#      login only). If you've since added your own SSH key to the droplet
#      out of band, that works too -- just isn't assumed here.
#
#   3. In that console, run Step 1's commands to provision the two throwaway
#      Keycloak users (needs KEYCLOAK_ADMIN_PASSWORD -- see Step 1's own
#      note below for where to find it if not on hand).
#
#   4. Still on the droplet (or from your laptop over the tailnet -- see
#      Step 2's own note), run Step 2's commands to get bearer tokens for
#      both users.
#
#   5. On the droplet, run Step 3's commands to exercise the actual
#      capability-check + audit-chain routes and confirm the expected
#      201 / 403 / audit-chain-valid results.
#
#   6. On the droplet, run Step 4's commands to delete both throwaway users
#      again.
#
#   7. Report the results on #18 (verifier allowed, technologist-only
#      refused with 403, audit chain still valid).
#
# Rationale for why steps 3 and 4/6 must run ON the droplet specifically,
# while step 2 can run from anywhere with tailnet access:
#   - Keycloak *is* externally reachable via tailscale serve on :8443 (same as
#     the #232 browser login used), so the token step below *could* run
#     externally -- kept here anyway so the whole thing is one script.
#   - apps/api has **no exposed port at all** (infra/docker-compose.staging.yml:
#     `api:` has no `ports:` mapping, unlike `web`'s 127.0.0.1:3000). It's
#     reachable only from other containers on the `lis_staging_net` Docker
#     network. apps/web never proxies to it either (confirmed: no rewrites/
#     proxy route in apps/web). So the capability-check calls below go through
#     `docker run --network lis_staging_net curlimages/curl`, run from the
#     droplet itself.
#   - staging's Keycloak import deliberately strips the checked-in
#     test-user/test-user-2 (deploy-staging.yml: `jq 'del(.users)'`) -- correct
#     hardening, but it means step 1 (provisioning a real role-bearing user)
#     is required before this can run at all; it doesn't exist yet.

set -euo pipefail

MAGICDNS="lis-staging.taila0fbf9.ts.net"   # confirmed reachable this session (#232)
REALM="lis"
CLIENT_ID="lis-web"                          # public client, directAccessGrantsEnabled=true

echo "== Step 1: provision a throwaway 'verifier'-role user in Keycloak =="
echo "First, on the droplet, pick a throwaway password and export it:"
echo '  export NEW_PASS="$(openssl rand -base64 24)"'
echo
echo "KEYCLOAK_ADMIN_PASSWORD is NOT a shell variable that exists anywhere on"
echo "the droplet -- it only lives inside the running keycloak container's own"
echo "environment (docker-compose.staging.yml's environment: block, itself"
echo "sourced from the GitHub secret of the same name, which is write-only --"
echo "gh secret list can't print it back, by design, not a lost value)."
echo "Fetch it from that container's own env before using it below:"
echo '  export KEYCLOAK_ADMIN_PASSWORD=$(docker exec $(docker ps -qf name=keycloak) printenv KC_BOOTSTRAP_ADMIN_PASSWORD)'
echo "(Valid as long as this exact container has been running continuously"
echo "since its last boot -- KC_BOOTSTRAP_ADMIN_PASSWORD only applies to a"
echo "fresh master realm, so if the container were ever restarted after a"
echo "*different* secret value had been set, this would need Keycloak's own"
echo "bootstrap-admin recovery command instead: https://github.com/keycloak/keycloak/blob/main/docs/guides/server/bootstrap-admin-recovery.adoc)"
echo
echo "Then run via kcadm inside the keycloak container (has admin CLI bundled):"
cat <<'EOF'
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD"

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh create users \
  -r lis -s username=verify-demo-user -s enabled=true

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh set-password \
  -r lis --username verify-demo-user --new-password "$NEW_PASS" --temporary=false

docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh add-roles \
  -r lis --uusername verify-demo-user --rolename verifier

# and a second one for the negative-case proof (must be refused):
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh create users \
  -r lis -s username=technologist-only-demo-user -s enabled=true
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh set-password \
  -r lis --username technologist-only-demo-user --new-password "$NEW_PASS" --temporary=false
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh add-roles \
  -r lis --uusername technologist-only-demo-user --rolename technologist
EOF
echo

echo "== Step 2: get tokens (password grant, external -- tailnet reachable) =="
cat <<EOF
TOKEN_VERIFIER=\$(curl -sS -d "grant_type=password" -d "client_id=${CLIENT_ID}" \\
  -d "username=verify-demo-user" -d "password=\$NEW_PASS" \\
  "https://${MAGICDNS}:8443/realms/${REALM}/protocol/openid-connect/token" | jq -r .access_token)

TOKEN_TECH_ONLY=\$(curl -sS -d "grant_type=password" -d "client_id=${CLIENT_ID}" \\
  -d "username=technologist-only-demo-user" -d "password=\$NEW_PASS" \\
  "https://${MAGICDNS}:8443/realms/${REALM}/protocol/openid-connect/token" | jq -r .access_token)
EOF
echo

echo "== Step 3: exercise the capability-check routes (must run ON the droplet,"
echo "   via a container on lis_staging_net -- api has no external port) =="
cat <<'EOF'
# Positive case: verifier role -> expect 201 + resourceId
docker run --rm --network lis_staging_net curlimages/curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN_VERIFIER" \
  http://api:4000/auth/capability-check/verify

# Negative case: technologist-only role attempting :verify -> expect 403
docker run --rm --network lis_staging_net curlimages/curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN_TECH_ONLY" \
  http://api:4000/auth/capability-check/verify

# Audit trail: confirm the verify call above produced a hash-chain-valid audit_event row
docker run --rm --network lis_staging_net curlimages/curl -sS \
  -H "Authorization: Bearer $TOKEN_VERIFIER" \
  http://api:4000/auth/capability-check/audit-chain-valid
EOF
echo

echo "== Step 4: cleanup -- delete the two throwaway users when done =="
cat <<'EOF'
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh delete users/$( \
  docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh get users -r lis -q username=verify-demo-user --fields id --format csv --noquotes) -r lis
docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh delete users/$( \
  docker exec -i $(docker ps -qf name=keycloak) /opt/keycloak/bin/kcadm.sh get users -r lis -q username=technologist-only-demo-user --fields id --format csv --noquotes) -r lis
EOF
