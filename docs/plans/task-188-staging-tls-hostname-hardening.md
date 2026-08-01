# Implementation Proposal: Staging TLS + KC_HOSTNAME hardening
Status: APPROVED
ADR: none — Tailscale-only is a direct extension of ADR-0003's existing precedent, not a new
architectural decision
Date: 2026-08-01    Backlog ID: #188

## 1. Goal

Staging's Keycloak runs `start-dev --import-realm` with no TLS and no `KC_HOSTNAME` — flagged
since TASK-030/031 (see `infra/docker-compose.staging.yml`'s own comments) but never fixed.
Consequence, confirmed directly against Keycloak's own docs this session: `apps/web`'s
`NODE_ENV=production` correctly marks session/PKCE cookies `Secure`, which a real browser
silently refuses to send over plain HTTP — so the full login/logout round-trip cannot complete
against staging at all today, for any FEAT-008-dependent feature. `KEYCLOAK_ISSUER_URL` also
resolves to the Docker-internal hostname (`http://keycloak:8080/...`), unreachable by a browser
even if cookies weren't blocking it. Fixing this once unblocks every M2+ feature stuck on the
same "demoed on staging" DoD requirement (#17, #18, and everything after).

**RESOLVED 2026-08-01 — Tailscale-only, not a public domain.** Staging stays reachable only to
people on (or invited to) the tailnet, consistent with ADR-0003's existing precedent for this
same droplet. No domain purchase, no new public attack surface.

## 2. Affected files

- `infra/docker-compose.staging.yml` — Keycloak's command changes from `start-dev --import-realm`
  to `start --import-realm` (Keycloak's own docs, verified via Context7: `start-dev` is
  explicitly dev-only — production mode requires HTTPS/hostname configured or the server refuses
  to boot, a "secure by default" design, not an oversight to route around) with
  `--hostname`/`--proxy-headers` set for the new MagicDNS hostname. `api`'s port mapping (`4000`)
  removed per §10 Q2 (never browser-facing, never targeted by `tailscale serve`). **`web`
  (`3000`) and `keycloak` (`8080`) corrected post-implementation to `127.0.0.1:<port>:<port>`,
  not removed entirely as originally planned** — real bug found on this task's live deploy
  attempts: `tailscale serve` runs on the droplet's *host* OS, so `http://localhost:<port>` in
  its config means the host's own loopback, which has nothing listening on it without a
  published port at all (the container's port only exists inside Docker's private bridge
  network otherwise). Bound to `127.0.0.1` specifically, not `0.0.0.0` — real reachability for
  `tailscale serve` (and only same-host processes) without exposing the port to the wider
  network, keeping the spirit of the original no-exposure intent.
- **No new container.** `tailscale serve` (see §5) runs as tailscaled config on the droplet
  itself, not a new compose service — a real memory-budget win over the originally-considered
  Caddy reverse proxy, relevant given this box's existing 848m/961Mi allocation (§6).
- `apps/api`/`apps/web`'s `KEYCLOAK_ISSUER_URL` env value (deploy-time only, no code change) —
  updated to the new MagicDNS hostname instead of the internal `keycloak:8080`.
- `.github/workflows/deploy-staging.yml` — a new step to configure `tailscale serve` (idempotent,
  safe to re-run every deploy) and updated `.env` generation for the new hostname values. No new
  secret needed — this reuses the already-present `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET`.
- `infra/keycloak/README.md` — document the new hostname reality; currently documents this exact
  gap as still-open (TASK-028 note).
- `infra/main.tf` — **not touched.** No DNS resource needed for the Tailscale-only path.

## 3. Architecture consulted

- **Keycloak's own docs** (verified via Context7, `/keycloak/keycloak`, this session) —
  confirmed `start` vs `start-dev`'s real behavioral difference (production mode requires
  hostname + TLS configured, refuses to boot otherwise), and the `hostname:v2` provider's
  independently-configurable frontend/admin/backchannel URL tiers plus `--proxy-headers` for a
  TLS-terminating-reverse-proxy setup — applies whether the proxy is Caddy or `tailscale serve`.
- **Tailscale's own docs** (verified via Context7, `/websites/tailscale`, this session) —
  confirmed `tailscale serve` terminates HTTPS and proxies to a local port/service directly, with
  **automatic** cert provisioning and renewal (distinct from the lower-level `tailscale cert`
  command, which only writes cert/key files to disk and requires *manual* renewal every 90 days —
  the wrong tool here specifically because it doesn't auto-renew). `tailscale serve`'s newer
  named-services mechanism (`--service=svc:<name>`) supports multiple backends behind one
  hostname via `--set-path`, which is what makes routing api/web/Keycloak through one MagicDNS
  hostname without a separate proxy container possible.
- **ADR-0003 (Tailscale for CI-to-staging deploy access)** — this proposal extends that same
  precedent (avoid public exposure where a private-network alternative exists) to human demo
  access too, now that the human has confirmed Tailscale-only is acceptable for that audience.
- **`docker-pnpm-monorepo-deploy` Skill** — loaded in full given this touches the same
  `docker-compose.staging.yml`/deploy pipeline as this session's OOM (#201) and stale-network
  findings (entries 10–14) — directly relevant to §6 and §8's deploy-sequencing caution.
- **`engineering/authentication` Skill** — already flags this exact gap (line 265) with no
  further solution detail — this proposal is that follow-through.

## 4. Skills loaded

- `docker-pnpm-monorepo-deploy` — in full, per §3.
- `engineering/authentication` — in full, confirms no conflicting guidance exists.
- `rls-multi-tenancy` — checked, not relevant (no tenant-scoped table or RLS policy touched).

## 5. Assumptions & autonomous decisions

- **`tailscale serve`, not a separate reverse-proxy container (Caddy or otherwise).** Originally
  planned as Caddy in this proposal's draft; superseded once Tailscale-only was confirmed —
  `tailscale serve` does the same job (TLS termination + routing) with zero added memory
  footprint (tailscaled is already running on this droplet for deploy access) and automatic cert
  renewal, strictly better on every axis for this specific choice. Not re-raised as a question —
  a clear improvement given the constraint, not a genuine tradeoff.
- **Path-based routing under one MagicDNS hostname** (`/` → web, `/api/*` → api, an auth path →
  Keycloak with `--http-relative-path` set to match) rather than separate hostnames per service —
  simpler `tailscale serve` config, one cert. The exact path scheme is an implementation detail
  to finalize during the work itself, not pinned precisely here (some of Tailscale Services'
  multi-backend routing mechanics weren't fully verifiable from documentation alone — confirming
  the real behavior during implementation, consistent with this session's "verify, don't assume"
  discipline for anything not independently confirmed).

## 6. Risks

- **Memory budget is already tight**, though less of a risk now than under the original Caddy
  plan: 192(postgres)+48(valkey)+320(keycloak)+128(api)+160(web) = 848m of ~961Mi total
  (`docker-pnpm-monorepo-deploy` Skill entry 13). `tailscale serve` adds no new container, but
  Keycloak's `start` (production) mode may have a different memory profile than `start-dev` —
  not verified here, worth watching (`free -h`) on the first real deploy rather than assuming
  parity.
- **Downtime during the cutover.** Changing Keycloak's startup mode, removing direct port
  mappings, and updating every service's issuer-URL env value together is exactly the kind of
  multi-part change that produced the stale-network incident earlier this session. Sequenced
  deploy, not a single atomic swap — see §8.
- **`tailscale serve`'s multi-backend path routing is the least-verified part of this plan**
  (per §5) — real risk that the exact CLI invocation needs iteration during implementation, not
  a first-try success. Budget for that rather than assume the config in this proposal is final.
- **Cert issuance must actually be verified working, not assumed from config correctness** — same
  "a green step is not proof" discipline as every other finding already documented in the deploy
  Skill this session.

## 7. Acceptance criteria

Per issue #188:
- [ ] Full browser-facing login/logout flow completes against staging over real HTTPS, via the
  tailnet (manual verification — this sandbox still has no working local browser per
  TASK-034/035/037's own documented limitation; needs the human, or someone else on the tailnet).
- [ ] Keycloak runs in production mode (`start`, not `start-dev`) with `KC_HOSTNAME` resolving to
  the real MagicDNS hostname for both the frontend and backchannel URL tiers.
- [ ] `apps/web`'s `Secure` session/PKCE cookies are actually sent/accepted (implied by the above
  completing at all).

## 8. Testing plan

1. Deploy sequence ordered to avoid the stale-network-style incident: configure `tailscale serve`
   and confirm it correctly routes and terminates TLS *before* removing the direct port mappings
   or switching Keycloak/api/web to the new hostname values — not a single atomic cutover with no
   fallback path.
2. `free -h` on the droplet directly after deploy (same verification method as the OOM incident).
3. Real browser login/logout against the new MagicDNS hostname (human-performed, per §7).
4. Certificate validity checked directly against the real endpoint, not just trusted from
   `tailscale serve`'s own config output.

## 9. Rollback plan

Compose/deploy-workflow changes revert via the PR. `tailscale serve` config is cleared with
`tailscale serve clear` if it needs to be undone independently of a code revert. Keycloak
reverting to `start-dev` is a one-line compose change if the production-mode cutover causes an
unexpected problem — not a one-way door.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-01 — Tailscale-only.** See §1.
2. **RESOLVED 2026-08-01 — remove the direct port mappings.** `3000`/`4000`/`8080` come off
   entirely once `tailscale serve` fronts everything — single HTTPS entrypoint only, no second
   path to keep consistent with the new hostname/cookie config. Direct debugging, if ever needed,
   via SSH + `curl localhost:<port>` on the droplet itself.

**Both questions resolved — see Status header.**

## 11. Verified — real deploy outcome (2026-08-01)

Deployed and confirmed working end-to-end via 11 real live deploy attempts (10 failures, each
a distinct real bug found via direct evidence — `docker compose logs`/`ps` on the droplet, not
guessed twice in a row — see the `docker-pnpm-monorepo-deploy` Skill entries 15–22 for full
detail on each). Run [30691557172](https://github.com/mathewkaplos/lis-platform/actions/runs/30691557172)
is the first fully green run: `Smoke test (api, internal)` and
`Smoke test (web + Keycloak, real HTTPS over the tailnet)` both passed — the latter making a
real HTTPS request from the CI runner (itself tailnet-joined) against
`https://lis-staging.taila0fbf9.ts.net/` and
`https://lis-staging.taila0fbf9.ts.net:8443/realms/lis/.well-known/openid-configuration`, the
same paths a real browser would use. This is the actual proof this proposal's §7 acceptance
criteria required — not just "the deploy step exited 0."

Fixes required beyond this proposal's original plan (merged as separate PRs, all on
lis-platform main): #219 (MagicDNS discovery matched every tailnet peer), #220 (curl timeout
missing), #221 (curl `-s` hid real errors), #222 (`tailscale serve` needs a real host-local
listener, not a removed port mapping), a tailnet ACL port-scope widening (human action, no PR —
Tailscale admin console), #224 (`KC_HTTP_ENABLED` required in Keycloak production mode), #225
(prune step needed `if: always()`), #226 (`KC_PROXY_HEADERS` value reverted — image-version-
specific), #227 (Keycloak's genuine first-boot time needed a wider retry window).
