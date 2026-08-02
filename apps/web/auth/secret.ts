const MIN_SECRET_BYTES = 32;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function requiredSecret(name: string): Uint8Array {
  const encoded = new TextEncoder().encode(requiredEnv(name));
  if (encoded.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_BYTES} bytes for HS256`,
    );
  }
  return encoded;
}

/**
 * Symmetric secret used to sign/verify both apps/web's own session cookie
 * and the short-lived PKCE/state cookie used across the login->callback
 * redirect (distinguished from each other by audience claim, not by key --
 * see session.ts/pkce-store.ts). apps/web is both issuer and sole verifier
 * of both, so HS256 with one shared secret is sufficient -- no asymmetric
 * keypair needed. Enforces >=32 bytes since a short/guessable value would
 * make HS256 forgeable -- catches a weak value (a copy-pasted dev default,
 * a too-short placeholder) loudly at startup rather than accepting it
 * silently.
 *
 * A FUNCTION, not a top-level constant -- confirmed 2026-08-03 as the real
 * cause of every staging login looping forever: proxy.ts (Next.js 16's
 * middleware-equivalent) still goes through the MiddlewarePlugin webpack
 * step, which does its own build-time `process.env.*` substitution --
 * separate from ordinary Route Handlers (login/callback), which read
 * process.env fresh at actual request time. A top-level `export const`
 * here gets permanently baked to the *build-time* SESSION_SECRET (a
 * deliberate placeholder, deploy-staging.yml's own
 * docker-build-placeholder-not-a-real-secret, chosen specifically so the
 * real secret never lands in a Docker layer) when read from proxy.ts,
 * while callback/route.ts's signSession() call correctly used the real
 * runtime secret -- verifySession() then failed every single time,
 * deterministically, since the two call sites were silently using
 * different keys. Reading it fresh inside each call sidesteps whichever
 * bundle a given caller happens to go through.
 */
export function getSessionSecret(): Uint8Array {
  return requiredSecret('SESSION_SECRET');
}
