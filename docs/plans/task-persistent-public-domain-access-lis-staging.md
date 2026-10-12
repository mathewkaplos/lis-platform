# Implementation Proposal: Persistent public-domain access to lis-staging
Status: APPROVED
ADR: n/a    Date: 2026-10-12    Backlog ID: n/a (user request, this session)

## 1. Goal

Replace Tailscale-only access to `lis-staging` with a persistent, real-hostname public entry
point — siamas-caddy-style — so day-to-day development/testing doesn't require a VPN client on
every device. Explicitly **not** a revival of `docs/pilot-remote-access.md`'s raw-IP, temporary,
manually-applied-and-reverted approach: that was tried this session (2026-10-12) and hit a real,
structural dead end (see §3). This is meant to be a standing, low-maintenance addition, matching
how the unrelated `siamas` app already runs on this same droplet.

## 2. Why the raw-IP pilot approach cannot work (evidence from this session)

Attempted live against the real droplet, in order, each confirmed by direct inspection before
moving to the next:

1. **Port 80/443** already owned by `siamas-caddy-1` (unrelated app, 8+ days uptime). Moved to an
   alternate port.
2. **Port 8080** already owned by Keycloak's own pre-existing `127.0.0.1:8080` binding. Moved to
   8081 (confirmed free via `ss -ltnp`).
3. **Keycloak's realm `sslRequired: "external"`** rejects any plain-HTTP client that looks
   external, independent of the port — blocks login outright. Loosening to `"none"` works but is a
   real, if pilot-scoped, security regression.
4. **Structural dead end**: `apps/web`'s own server process must reach Keycloak's discovery
   endpoint at the *same* URL the browser uses (`KEYCLOAK_ISSUER_URL`, OIDC issuer-consistency
   requirement — see `apps/web/auth/oidc-config.ts`'s own existing comment, which already flagged
   this exact class of gap before this session). When that URL is a **raw IP**
   (`http://157.230.10.221:8081`), the request is container-to-container same-bridge "hairpin"
   traffic. Confirmed via packet capture: Docker's own nftables rules for published ports
   (`-A DOCKER -d <container-ip>/32 ! -i <bridge> -o <bridge> ... -j ACCEPT`) only admit traffic
   arriving from *outside* the bridge — same-origin-and-destination bridge traffic matches no rule
   and is silently dropped. `extra_hosts`-based workarounds don't apply either: IP-literal
   hostnames never consult `/etc/hosts` in any standard networking stack (confirmed directly —
   a raw TCP connect to the literal string `"157.230.10.221"` times out from inside `web`'s
   container even with a correct `/etc/hosts` entry present, while the identical connect to the
   same address written as a dotted-decimal target succeeds). Enabling `br_netfilter` (tried,
   then reverted after confirming no effect, with `siamas` re-verified unaffected throughout) does
   not change this, since it governs netfilter *visibility* into bridge traffic, not what rules
   Docker itself generates once visible.

**The fix for all four is the same move**: use a real hostname, not a raw IP. Caddy
virtual-hosts multiple domains on the same 80/443 (no port conflict). A real Let's Encrypt cert
means Keycloak's `sslRequired` default needs no change. Critically, **a real hostname — unlike an
IP literal — does get resolved via `/etc/hosts`**, so `extra_hosts`-based split-horizon DNS
(mapping the public hostname to nginx's internal Docker IP, for `web`/`api` only) correctly routes
the self-discovery call within the bridge network instead of attempting to hairpin out to the
public internet and back. This is a standard, well-documented pattern precisely for this class of
problem — not a novel workaround.

## 3. Proposed architecture

```
Browser --HTTPS--> siamas-caddy (or a 2nd Caddy instance), domain-routed, port 443 (shared)
                      |-- siamaske.duckdns.org     --> siamas-backend:8000 (existing, untouched)
                      |-- lis-staging.duckdns.org  --> lis-nginx:8081 (new)
                                                        |-- /realms/*, /resources/* --> keycloak:8080
                                                        |-- /*                      --> web:3000
```

- **Domain**: `lis-staging.duckdns.org` — registered 2026-10-12, confirmed resolving to
  `157.230.10.221`. Matches exactly what `siamas` already does on this droplet
  (`siamaske.duckdns.org`, confirmed via `siamas-caddy-1`'s own `SITE_ADDRESS` env var). Zero
  cost, no registrar needed.
- **TLS termination**: Caddy, auto-provisioned Let's Encrypt cert, same as siamas. Real HTTPS
  means `apps/web`'s cookies can stay `Secure` (no `NODE_ENV: staging` override needed) and
  Keycloak's `sslRequired: "external"` default is satisfied without modification.
- **Caddy routing**: **resolved 2026-10-12 — share `siamas-caddy-1`** (one Caddy process, a second
  site block added to its existing `Caddyfile`, keyed to `lis-staging.duckdns.org`). No new
  container, no new cert-storage volume. Any edit to that `Caddyfile` gets the same before/after
  verification this session already used for siamas (confirm its own `308` baseline still holds
  after the config reload).
- **`web`/`api` → Keycloak self-discovery**:
  `extra_hosts: ["lis-staging.duckdns.org:<nginx-internal-ip>"]` in
  the compose service definitions for `web` and `api`, mirroring this session's own
  (correctly-diagnosed, just inapplicable-to-an-IP) `docker-compose.pilot.yml` attempt. The
  nginx-internal-IP lookup (`docker inspect lis-nginx-1 --format '{{range
  .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`) needs to be re-done any time the nginx
  container is recreated, since Compose does not guarantee IP stability across recreations —
  this is a real, if minor, operational gotcha worth a one-line runbook note, not a blocker.
- **Realm config**: `sslRequired` stays at its current value (whatever `infra/keycloak/lis-realm.json`
  already has for the normal tailnet deploy) — real TLS means no loosening is needed, unlike the
  abandoned pilot approach.

## 4. Whether this replaces or supplements the Tailscale-only deploy

**Resolved 2026-10-12 — supplement.** `deploy-staging.yml`/`docker-compose.staging.yml` stay
exactly as-is; Tailscale remains the primary, CI-managed path. This domain+Caddy+nginx layer is an
*additional*, separately-managed overlay — closer in spirit to the abandoned pilot doc, but
persistent instead of apply/revert, and with the structural blocker actually fixed this time.

**Sharp edge this choice creates, to document prominently in the runbook**: every normal CI deploy
(any `git push` to `main`) recreates `web`/`api`/`keycloak` from the canonical compose file alone —
which will silently drop the overlay-only `extra_hosts` entry (§3). Public access will break after
every ordinary deploy until the overlay is manually reapplied. This is the direct cost of not
choosing "replace," accepted here in exchange for zero risk to the automated pipeline.

## 5. Affected files

- New (renamed from the abandoned pilot files, with the raw-IP assumptions removed):
  `infra/docker-compose.lis-public.yml`, `infra/nginx-public.conf` — manually applied, never
  referenced by CI (same `-f` discipline as the abandoned `docker-compose.pilot.yml`).
- The droplet's live `/opt/siamas/Caddyfile` (or wherever `siamas-caddy-1` mounts it from) — a new
  site block appended, the existing `siamaske.duckdns.org` block untouched. Not a repo file;
  tracked only in the runbook this proposal produces.
- `infra/keycloak/lis-realm.json` — no change expected (sslRequired untouched), but worth an
  explicit re-check once the domain is live, in case redirect-URI wildcarding needs a second look
  for a second public hostname.
- `.github/workflows/deploy-staging.yml`, `infra/docker-compose.staging.yml`,
  `infra/main.tf` — **not touched** (§4: supplement, not replace).
- `docs/pilot-remote-access.md` — superseded by this doc; marked as such, not deleted (a real,
  evidenced record of why the raw-IP approach doesn't work, worth keeping as institutional
  memory per this session's own findings).

## 6. Risks

- **Shared-box blast radius**: any Caddy config change (option 3a) touches `siamas`'s own working
  config file, even if only appending a new site block. Low risk if done as a pure addition with
  no edits to the existing block, but should be verified (siamas still responds correctly) after,
  the same way this session verified it after each droplet-level change.
- **DuckDNS reliability**: free dynamic-DNS service, not a registrar-backed domain — acceptable
  for a staging/pilot box (siamas already relies on it), not something to carry into a real
  production/customer-facing deploy without revisiting.
- **extra_hosts IP drift**: the nginx-internal-IP must be kept in sync across container
  recreations (see §3) — a real, recurring manual step unless automated (e.g., a small
  entrypoint script in `web`/`api` that resolves it at container start rather than hardcoding it
  in compose, which would remove this gotcha entirely — worth considering during implementation,
  not decided here).
- **Second public attack surface**: any new public HTTPS endpoint is new exposure, independent of
  how carefully it's built. Should get the same kind of real inspection this session already did
  for the pilot attempt (confirm only intended paths are proxied, `/admin/*` stays
  non-public, etc. — `nginx-pilot.conf`'s existing scoping already does this correctly and should
  carry over unchanged).

## 7. Acceptance criteria

- A real phone (or any device), on neither Tailscale nor the droplet's own LAN, can load the
  domain over HTTPS, log in with a real Keycloak-backed account, and use the app end-to-end
  (dashboard, patient list, order placement, AP case, report) — the same checklist
  `docs/pilot-remote-access.md` §8 already defines, just against a working setup this time.
- `siamas` is confirmed unaffected (same external HTTP/HTTPS response codes as before, all
  containers still healthy) after the change is applied.
- The setup survives a container recreation (`docker compose up -d --force-recreate` on
  `web`/`api`/`nginx`) without manual intervention, OR the manual step required (re-syncing
  `extra_hosts`) is clearly documented if not automated.

## 8. Testing plan

- Live-verify against the real droplet (per this repo's own Rule #0 — no local reproduction
  substitutes for this, since the whole premise is a live-infrastructure characteristic, exactly
  as this session's own debugging already demonstrated).
- Explicit before/after check of `siamas-caddy-1`'s own external response, the same baseline/
  after-comparison pattern already used in this session.

## 9. Rollback plan

Remove the Caddy site block from `siamas-caddy-1`'s config and reload/recreate it, and remove the
`lis-nginx` container. No change to `docker-compose.staging.yml`/`deploy-staging.yml` (§4:
supplement), so the next normal CI deploy is unaffected either way.

## 10. Questions — all resolved 2026-10-12

1. **Domain**: `lis-staging.duckdns.org`, registered by the user, confirmed resolving correctly
   to `157.230.10.221`.
2. **Caddy topology**: share `siamas-caddy-1` (one container, a second site block in its existing
   `Caddyfile`) — not a second, independent Caddy container.
3. **Lifecycle**: supplement the existing Tailscale-only CI deploy with a separately-managed
   overlay — not folded into `deploy-staging.yml`. Accepted trade-off: breaks silently after every
   normal `main` deploy until manually reapplied (§4).
4. **Persistence vs. bounded window**: bounded — not indefinite standing infrastructure. Gets an
   explicit teardown discipline in the runbook (§9), the same "don't leave this running longer
   than needed" spirit as the original pilot doc, actually enforced this time by someone
   remembering to invoke it.

**All open questions resolved — ready for `Status: APPROVED` on explicit confirmation.**

## 11. Implementation log

**Implemented and live-verified 2026-10-12.** `siamas-caddy-1` joined to `lis_staging_net`
(`docker network connect`, additive — its original `siamas_default` membership untouched) at
`172.18.0.8`. A second Caddyfile site block added for `lis-staging.duckdns.org`, reverse-proxying
to `lis-nginx-1`'s `lis_staging_net` IP (no host port published for nginx at all — reachable only
from Caddy). `docker-compose.lis-public.yml`/`nginx-public.conf` applied; `.env`'s three
public-URL vars and `extra_hosts` on `web`/`api` point at the real domain, not a raw IP.

**Confirmed externally, without `-k`** (i.e. against a genuinely trusted cert, not merely
"responds"):
- `https://lis-staging.duckdns.org/` → `307` (unauthenticated redirect, expected)
- `https://lis-staging.duckdns.org/realms/lis/.well-known/openid-configuration` → `200`
- `https://lis-staging.duckdns.org/api/auth/login?rd=%2F` → `307` to a fully correct OIDC
  authorization URL (right domain, right `redirect_uri`, PKCE challenge present, `client_id=lis-web`)
- `siamas` (`http://157.230.10.221/`) → `308` throughout every step, unaffected.

This is the structural fix, not a workaround: the earlier raw-IP hairpin failure is gone because
`web`/`api`'s self-discovery call now reaches Caddy directly via shared Docker-network addressing
(`extra_hosts` resolving a real hostname, exactly as predicted in §2) — no host-published-port
DNAT path involved at all.

**Remaining before §7's acceptance criteria are fully met**: the actual phone test (a real device,
on neither Tailscale nor the droplet's LAN, walking the full dashboard → patient → order → AP
case → report → logout/login checklist) — needs a human with a phone, not verifiable from here.

## 12. Full login flow verified live (browser automation), two more real bugs found and fixed

**2026-10-12, via Chrome automation (not a phone, but the same real external HTTPS path)**:

1. **`redirect_uri` rejected by Keycloak** — `lis-web`'s client config in
   `infra/keycloak/lis-realm.json` has an explicit `redirectUris`/`webOrigins` allowlist (not a
   wildcard), missing the new domain entirely. Fixed: added
   `https://lis-staging.duckdns.org/*` / `https://lis-staging.duckdns.org` alongside the existing
   localhost/tailnet entries, in the repo file itself (not just live) so this survives the next
   normal CI deploy too, independent of the overlay-drop gotcha in §4.
2. **`502` on `/api/auth/callback`** — nginx's default `proxy_buffer_size`/`proxy_buffers` (4k/8k)
   too small for `web`'s combined session+PKCE `Set-Cookie` headers on the callback response
   (`upstream sent too big header`, confirmed in nginx's own error log). Fixed in
   `nginx-public.conf`: `proxy_buffer_size 16k; proxy_buffers 4 16k; proxy_busy_buffers_size 32k;`
   on the `web` upstream's `location /` block.

**After both fixes, the full flow was confirmed working end-to-end**: real Keycloak login page →
credentials accepted → authorization code issued → callback succeeded → full authenticated
dashboard rendered (Worklist, sidebar nav, tenant ID) → `/patients` loaded via real client-side
navigation, empty-state query hitting the live database (not cached). This is the structural fix
from §2/§3 actually working, not merely reachable.

Both fixes are in the repo's committed-ready files (`infra/keycloak/lis-realm.json`,
`infra/nginx-public.conf`) but not yet pushed to `main` as of this writing — do that before
relying on this surviving any droplet-side file loss.

**Still outstanding for full §7 completion**: order placement, AP case, report, logout/login —
and a genuine phone (different network, different device) rather than browser automation from
this session's own environment.
