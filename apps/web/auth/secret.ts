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
 */
export const SESSION_SECRET = requiredSecret('SESSION_SECRET');
