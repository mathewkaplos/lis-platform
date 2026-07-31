function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Symmetric secret used to sign/verify both apps/web's own session cookie
 * and the short-lived PKCE/state cookie used across the login->callback
 * redirect. apps/web is both issuer and sole verifier of both, so HS256
 * with one shared secret is sufficient -- no asymmetric keypair needed.
 */
export const SESSION_SECRET = new TextEncoder().encode(
  requiredEnv('SESSION_SECRET'),
);
