import { NextRequest } from 'next/server';

/**
 * The origin a real browser can reach this app at. request.nextUrl.origin
 * is wrong behind a reverse proxy in this Next.js version's standalone
 * server output (16.2.12): self-hosted "standalone" mode has no working
 * way to trust the incoming Host header (experimental.trustHostHeader is
 * silently dropped by config validation in this exact version, confirmed
 * by inspecting the built .next/required-server-files.json directly, not
 * assumed from newer/canary docs) -- route handlers fall back to the
 * server's own internal hostname instead, which on staging is Docker's
 * auto-assigned container ID (docker-compose.staging.yml's web service
 * sets no explicit hostname). PUBLIC_APP_URL is discovered fresh at deploy
 * time from Tailscale's own MagicDNS name, same pattern already used for
 * KEYCLOAK_PUBLIC_URL/KEYCLOAK_ISSUER_URL (deploy-staging.yml) -- unset in
 * local dev, where request.nextUrl.origin is already correct since there's
 * no reverse proxy in front of it.
 */
export function getPublicOrigin(request: NextRequest): string {
  return process.env.PUBLIC_APP_URL ?? request.nextUrl.origin;
}
