# Temporary public-IP access for phone testing (lis-staging)

Status: manual runbook, not automated. Not referenced by any CI workflow.

## Current progress / where this was left off

An SSH keypair was generated locally (on the machine running Claude Code)
specifically so Claude could apply this runbook directly against the
droplet instead of the user running each command by hand:

- Private key: `~/.ssh/lis_staging_pilot` (local to that machine only,
  never transmitted).
- Public key (needs adding to the droplet's `root` account —
  `/root/.ssh/authorized_keys`):
  ```
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDEhggdctJ4dOr1JKLrd2cenG/6QBLhhBSjXS66PX1JV claude-pilot-access
  ```

**Blocked**: the user does not currently have access to the DigitalOcean
console (needed to add the key via the recovery console, or to reset the
root password) and has no other terminal open to the droplet right now.
Nothing has been applied to the droplet yet — no `.env` changes, no
container recreation, no file copies. `infra/docker-compose.pilot.yml` and
`infra/nginx-pilot.conf` exist in the repo but are not yet on the droplet.

**To resume**: once DO console access (or any other existing shell) is
available, add the public key above to `/root/.ssh/authorized_keys`, then
either run the steps in section 4 by hand, or have Claude run them via
`ssh -i ~/.ssh/lis_staging_pilot root@<DROPLET_IP>`.
Purpose: let a phone browser on a different network reach the existing
`lis-staging` droplet at `http://<DROPLET_IP>` and complete a real Keycloak
login, for a short pilot/testing session.

**This intentionally changes lis-staging's security posture for as long as
it's applied.** lis-staging is normally reachable only over Tailscale
(ADR-0003, issue #188) — this runbook adds a plain-HTTP public entry point on
top of that, with non-Secure cookies. Do this only for a bounded testing
window and revert afterward (see the end of this doc).

## 1. Current architecture (as of this writing)

- `apps/web` (Next.js, standalone) and `apps/api` (NestJS) run as separate
  containers, one Postgres 16, one Valkey, one MinIO, one Keycloak 26 —
  `infra/docker-compose.staging.yml`, deployed by
  `.github/workflows/deploy-staging.yml` on every push to `main`.
- Browser never calls `apps/api` directly — `apps/web` is a BFF: all
  patient/order/case/report data flows browser → web (Server
  Actions/route handlers) → `api:4000` (Docker-internal only, no host port).
  No CORS config exists anywhere because no cross-origin browser→API call
  ever happens.
- Auth is the standard OIDC BFF pattern: `apps/web`'s `/api/auth/login`,
  `/callback`, `/logout` routes do the Authorization Code + PKCE exchange
  server-side against Keycloak; the browser only ever sees an
  `httpOnly` session cookie, never a raw token.
- Today, the **only** browser-reachable entry points on staging are
  `https://<tailscale-magicdns-name>` (web, port 443) and
  `https://<tailscale-magicdns-name>:8443` (Keycloak), both terminated by
  `tailscale serve` running on the droplet's host OS — not a container, not
  in `docker-compose.staging.yml`. This only works for phones that have
  joined the tailnet.
- `docker-compose.staging.yml` publishes `web` and `keycloak` only on
  `127.0.0.1` (host-loopback), consumed exclusively by `tailscale serve`.
  Postgres/Valkey/MinIO/api publish **no host ports at all**.
- Secure cookies are gated on `NODE_ENV === 'production'`
  (`apps/web/auth/session.ts:215`, `apps/web/app/api/auth/login/route.ts:55`)
  — baked into the web image's Dockerfile as `ENV NODE_ENV=production`, but
  overridable at container-start via `docker compose`'s `environment:`.
- `KEYCLOAK_ISSUER_URL` (server-side discovery target) and `KC_HOSTNAME`
  (what Keycloak stamps into every URL in its discovery document) are set
  to the **same** public tailnet URL at deploy time
  (`deploy-staging.yml`, discovered fresh from `tailscale status --self
  --json` every deploy) — this decoupling is what lets the container reach
  Keycloak however it wants while every URL a browser actually receives
  still points at a real, browser-reachable host.
- The DigitalOcean firewall (`infra/main.tf`) already allows inbound 80 and
  443 from `0.0.0.0/0` — added for `tailscale serve`'s own use, but nothing
  currently listens on the droplet's *public* interface on either port
  (`tailscale serve` binds only the tailnet interface). **No firewall
  change is needed for this runbook.**
- Keycloak has no persisted data volume on this droplet — every deploy that
  touches it (`docker compose rm -f -s keycloak`) wipes its state back to
  whatever `infra/keycloak/lis-realm.json` says. Staging's real deploy
  strips the file's checked-in test users first (`jq 'del(.users)'`); this
  runbook deliberately does **not** — see step 3.

## 2. Why a domain isn't required here, and why HTTPS isn't either

Keycloak/OIDC does not need HTTPS as a protocol matter — it needs the
browser to actually send the cookies your app sets, and a browser silently
drops any cookie marked `Secure` when the page isn't loaded over HTTPS.
Since that `Secure` flag in this app is just `NODE_ENV === 'production'`
(not hardcoded), setting it to something else removes the requirement
entirely, at the explicit cost of the session/PKCE cookies traveling
unencrypted. That trade is accepted here for a short pilot window with
synthetic data only (this is the "Plain HTTP" choice already made below).

A domain becomes necessary only once you want a browser-*trusted* cert
(Let's Encrypt and every public CA validate domain ownership, not raw IPs).
It is not necessary for OIDC to function, and not used in this runbook.

## 3. Recommended architecture for this pilot

```
Phone --HTTP--> droplet:80 (nginx, new)
                   |-- /realms/*, /resources/*  --> keycloak:8080 (internal)
                   \-- everything else           --> web:3000 (internal)
                                                        |
                                                        v
                                                     api:4000 (internal only)
                                                        |
                                                        v
                                                     postgres (internal only)
```

One new public entry point (port 80, already allowed by the firewall).
Postgres/Valkey/MinIO/api gain zero new exposure. Keycloak's `/admin/*` is
deliberately **not** proxied — admin access stays on the existing
`127.0.0.1:8080` binding only, reachable by SSH tunnel if ever needed, never
publicly.

Two new files (already added to this repo, unused by CI):
- `infra/docker-compose.pilot.yml` — overlay: adds the `nginx` service,
  overrides `web`'s `NODE_ENV` to `staging` (non-Secure cookies).
- `infra/nginx-pilot.conf` — the path-routing config above.

## 4. Exact steps — "DO THIS NOW"

Run these on your machine (needs SSH access to the droplet — the same
`DEPLOY_HOST`/key used by CI, or your own key if you have direct root
access) and replace `<DROPLET_IP>` with the real public IP throughout
(`terraform output staging_ip` in `infra/`, or the DO console).

```bash
# 1. Copy the two new files up, plus the FULL (test-user-included) realm
#    file -- deliberately not the CI-stripped version, since you need a
#    real login for the phone test. This overwrites whatever realm file is
#    currently on the droplet; it's regenerated by the next normal CI
#    deploy anyway.
scp infra/docker-compose.pilot.yml root@<DROPLET_IP>:/opt/lis/
scp infra/nginx-pilot.conf root@<DROPLET_IP>:/opt/lis/
scp infra/keycloak/lis-realm.json root@<DROPLET_IP>:/opt/lis/keycloak/lis-realm.json

# 2. SSH in and flip the three URL-shaped env vars from the tailnet values
#    to the public IP. Back up .env first so reverting is a one-line copy.
ssh root@<DROPLET_IP>
cd /opt/lis
cp .env .env.tailscale-backup

sed -i "s#^KEYCLOAK_PUBLIC_URL=.*#KEYCLOAK_PUBLIC_URL=http://<DROPLET_IP>#" .env
sed -i "s#^KEYCLOAK_ISSUER_URL=.*#KEYCLOAK_ISSUER_URL=http://<DROPLET_IP>/realms/lis#" .env
sed -i "s#^PUBLIC_APP_URL=.*#PUBLIC_APP_URL=http://<DROPLET_IP>#" .env

# 3. Recreate exactly the containers that need the new config/image. This
#    also re-imports lis-realm.json fresh (keycloak has no persisted
#    volume, so --import-realm always re-runs on a fresh container), giving
#    you the checked-in test-user/test-password again.
docker compose -f docker-compose.yml -f docker-compose.pilot.yml \
  up -d --force-recreate keycloak api web nginx

# 4. Wait ~60-90s for Keycloak to finish importing, then confirm from the
#    droplet itself that both public paths respond:
curl -sSf http://localhost/ -o /dev/null -w "web: %{http_code}\n"
curl -sSf http://localhost/realms/lis/.well-known/openid-configuration \
  -o /dev/null -w "keycloak: %{http_code}\n"
```

## 5. Environment variables changed

| Variable | Old (tailnet) value | New (pilot) value |
|---|---|---|
| `KEYCLOAK_PUBLIC_URL` | `https://<magicdns>:8443` | `http://<DROPLET_IP>` |
| `KEYCLOAK_ISSUER_URL` | `https://<magicdns>:8443/realms/lis` | `http://<DROPLET_IP>/realms/lis` |
| `PUBLIC_APP_URL` | `https://<magicdns>` | `http://<DROPLET_IP>` |
| `web`'s `NODE_ENV` | `production` | `staging` (via the overlay file — disables `Secure` cookies) |

Everything else (`APP_DATABASE_URL`, `SESSION_SECRET`, `SIGNING_SECRET`,
`OBJECT_STORAGE_*`, etc.) is unchanged.

## 6. Keycloak configuration

No change to `infra/keycloak/lis-realm.json` itself — `lis-web`'s redirect
URIs are already `"+"`/wildcard-style relative to whatever `KC_HOSTNAME`
resolves to (see `infra/keycloak/README.md`), so pinning `KC_HOSTNAME` to
the public IP via `KEYCLOAK_PUBLIC_URL` above is sufficient; no per-client
redirect URI edits are needed. `KC_HTTP_ENABLED=true` and
`KC_PROXY_HEADERS=xforwarded` (both already in
`docker-compose.staging.yml`) are unaffected and still correct.

## 7. Firewall / Docker port changes

None. Port 80 is already open in `infra/main.tf`. No new `digitalocean_
firewall` rule, no Terraform apply needed. The only new Docker-side
exposure is the new `nginx` container's `80:80` binding, added by the
overlay file.

## 8. The phone test

Open `http://<DROPLET_IP>` in a phone browser **not** on the droplet's
tailnet or the same LAN. Log in with `test-user` / `test-password`
(tenant `00000000-0000-0000-0000-000000000001` — see
`infra/keycloak/README.md`). Walk through: dashboard loads → patient list
loads → register a synthetic patient → place a test order → open/act on an
AP case → view a report → log out → log back in.

Since the browser never calls `apps/api` directly (BFF pattern — see
section 1), "the browser can reach the API" shows up as web's Server
Actions succeeding (pages render real data), not as an `api:4000` request
in the phone's own network tab. To confirm data is flowing through the real
remote stack rather than something cached/local: watch `docker compose
logs -f api` on the droplet while using the app from the phone, and confirm
request lines appear in real time.

## 9. Troubleshooting

- **nginx container won't bind port 80**: something else on the droplet
  already listens there. Check with `ss -ltnp | grep :80`.
- **Login redirects to Keycloak but then fails / wrong-host error on
  callback**: `KEYCLOAK_ISSUER_URL`/`KEYCLOAK_PUBLIC_URL`/`PUBLIC_APP_URL`
  don't all agree, or `keycloak`/`web`/`api` weren't actually recreated —
  confirm with `docker compose exec web env | grep -E 'PUBLIC_APP_URL|KEYCLOAK'`.
- **`web`/`api` container fails discovery against Keycloak
  (`ECONNREFUSED`/timeout to `http://<DROPLET_IP>/realms/lis`)**: this is
  the one real unknown in this design — `KEYCLOAK_ISSUER_URL` is
  deliberately the *public* IP (not the internal `keycloak:8080` hostname)
  so it matches what `KC_HOSTNAME` stamps into the discovery document
  (OIDC discovery requires the two to match). That means the container
  calls back out to the droplet's own public IP and back in through nginx
  — this "hairpin" generally works on a plain DigitalOcean droplet (the
  public IP is bound directly to its own interface, not behind a NAT/LB),
  and the existing tailnet setup already relies on the same trick, but
  verify with `docker compose exec web curl -sSf
  http://<DROPLET_IP>/realms/lis/.well-known/openid-configuration` if login
  hangs or 502s.
- **Browser shows the login page but the session doesn't stick / bounces
  back to login**: `web`'s `NODE_ENV` didn't actually flip — confirm with
  `docker compose exec web env | grep NODE_ENV` (must be `staging`, not
  `production`); if it still says `production`, the overlay file wasn't
  passed via `-f` on the `up` command.
- **`invalid_grant`/wrong password logging in**: use `test-password`
  (literal), not a guessed variant — see `infra/keycloak/README.md`'s
  per-user password convention if using a different seeded user.
- **Keycloak takes ~60-90s after `--force-recreate`**: this matches
  `deploy-staging.yml`'s own smoke test, which allows up to 40×5s for this
  exact reason.

## 10. Revert to normal staging (do this when the pilot is done)

The safest revert is simply letting the next normal CI deploy happen (a
plain push to `main`, or `workflow_dispatch` on `deploy-staging.yml`) — it
regenerates `.env` fresh from Tailscale state and recreates every container
from `docker-compose.yml` alone, with no trace of the overlay file (it's
never referenced by CI).

To revert immediately without waiting for a deploy:

```bash
ssh root@<DROPLET_IP>
cd /opt/lis
docker compose stop nginx && docker compose rm -f nginx
cp .env.tailscale-backup .env
docker compose up -d --force-recreate keycloak api web
```

This also means: don't leave the pilot running longer than you need it —
the plain-HTTP entry point and the restored test-password realm are both
real, if modest, exposures.

## 11. What this deliberately does NOT do

- Does not expose Postgres, Valkey, or MinIO — unchanged, no host ports.
- Does not expose Keycloak's `/admin/*` — not proxied by nginx; only
  `127.0.0.1:8080` (as before).
- Does not touch `.github/workflows/deploy-staging.yml` or
  `infra/docker-compose.staging.yml` — the automated pipeline is unaffected
  and will overwrite this pilot's manual changes on its next run.
- Does not weaken tenant isolation, RLS, or any application-level auth
  check — only the transport-security posture (HTTP vs HTTPS) and the
  presence of a real test account change.
