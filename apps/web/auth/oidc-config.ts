import * as client from 'openid-client';

/**
 * Server-side issuer used for discovery, token exchange, and JWKS --
 * reachable from wherever this Next.js process itself runs (the host's
 * localhost in local dev, the docker-compose-internal "keycloak" hostname
 * in staging). Matches apps/api's own KEYCLOAK_ISSUER_URL convention and
 * default exactly (apps/api/src/auth/keycloak-config.ts).
 *
 * KNOWN GAP (same class TASK-028 already flagged for start-dev/KC_HOSTNAME,
 * see infra/keycloak/README.md): Keycloak reflects back whichever hostname
 * it was reached at as the issuer/endpoint base for every URL in its
 * discovery document, since KC_HOSTNAME is not pinned yet. In local dev this
 * coincides with the browser's own view of Keycloak (both are
 * localhost:8080), so the full login flow works end-to-end. In staging,
 * where this process reaches Keycloak over the internal Docker network but
 * an external browser cannot, the authorization/end-session URLs this
 * module builds would not be browser-reachable -- a real, pre-existing
 * "realm hardening for real deployment" gap, not solved by this task.
 */
export const KEYCLOAK_ISSUER_URL =
  process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis';

// lis-web is a public client (Authorization Code + PKCE, no client secret)
// per infra/keycloak/README.md -- fixed, non-secret, matches lis-realm.json.
export const KEYCLOAK_WEB_CLIENT_ID = 'lis-web';

let configPromise: Promise<client.Configuration> | undefined;

/**
 * Discovery is memoized at module scope -- one HTTP round-trip to
 * Keycloak's well-known document per server process lifetime, not per
 * request. client.None() is lis-web's authentication method since it is a
 * public client with no client secret to send.
 */
export function getOidcConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    configPromise = client.discovery(
      new URL(KEYCLOAK_ISSUER_URL),
      KEYCLOAK_WEB_CLIENT_ID,
      undefined,
      client.None(),
      {
        // openid-client refuses plain HTTP by default (OAuth 2.1 posture).
        // Both local dev and this project's current staging deployment run
        // Keycloak over plain HTTP (no TLS termination exists anywhere in
        // this repo yet -- the same deferred "realm hardening for real
        // deployment" gap TASK-028 already flagged). Remove this once real
        // TLS termination exists in front of Keycloak.
        execute: [client.allowInsecureRequests],
      },
    )
      .then((config) => {
        // authorizationCodeGrant() (callback/route.ts) derives its own
        // redirect_uri for the token-endpoint request from the passed
        // Request's own URL -- same broken origin as request.nextUrl.origin
        // behind a reverse proxy in this Next.js version's standalone
        // output (see public-origin.ts). Keycloak then rejects the token
        // exchange outright as a redirect_uri mismatch against what was
        // actually used at the authorization step (login/route.ts, already
        // corrected via getPublicOrigin), landing the user back on a
        // failed-login redirect instead of completing the round trip.
        // openid-client's own docs (customFetch.md) document exactly this
        // correction for exactly this situation. No-op in local dev, where
        // PUBLIC_APP_URL is unset and request.nextUrl.origin is already
        // correct.
        if (process.env.PUBLIC_APP_URL) {
          const correctRedirectUri = `${process.env.PUBLIC_APP_URL}/api/auth/callback`;
          config[client.customFetch] = (url: string, options) => {
            if (
              options?.body instanceof URLSearchParams &&
              options.body.get('grant_type') === 'authorization_code'
            ) {
              options.body.set('redirect_uri', correctRedirectUri);
            }
            return fetch(url, options as RequestInit);
          };
        }
        return config;
      })
      .catch((error: unknown) => {
        // Do not memoize a failed discovery -- e.g. Keycloak not ready yet
        // when the first login request lands. Without this, every future
        // /api/auth/* request would reject for the whole process lifetime,
        // recoverable only by a restart.
        configPromise = undefined;
        throw error;
      });
  }
  return configPromise;
}
