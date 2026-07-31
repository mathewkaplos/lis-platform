import { jwtVerify, SignJWT } from 'jose';
import { SESSION_SECRET } from './secret';

export const PKCE_COOKIE_NAME = 'lis_pkce';
const PKCE_TTL = '5m';
export const PKCE_MAX_AGE_SECONDS = 300;

/**
 * Bridges the redirect round-trip between /api/auth/login and
 * /api/auth/callback. Signed (not just httpOnly) so a tampered cookie is
 * rejected outright rather than silently trusted -- the values here are
 * exactly what authorizationCodeGrant() checks the IdP's response against.
 */
export interface PkceState {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirectTo: string;
}

// Distinguishes this token type from a session token (see session.ts's own
// SESSION_AUDIENCE comment) -- both share SESSION_SECRET, so without a
// per-type audience the two would be interchangeable HS256 JWTs.
const PKCE_AUDIENCE = 'lis:pkce';

export async function signPkceState(payload: PkceState): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(PKCE_TTL)
    .setAudience(PKCE_AUDIENCE)
    .sign(SESSION_SECRET);
}

export async function verifyPkceState(
  token: string,
): Promise<PkceState | undefined> {
  try {
    const { payload } = await jwtVerify<PkceState>(token, SESSION_SECRET, {
      audience: PKCE_AUDIENCE,
    });
    if (
      typeof payload.codeVerifier !== 'string' ||
      payload.codeVerifier.length === 0 ||
      typeof payload.state !== 'string' ||
      payload.state.length === 0 ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length === 0 ||
      typeof payload.redirectTo !== 'string'
    ) {
      return undefined;
    }
    return {
      codeVerifier: payload.codeVerifier,
      state: payload.state,
      nonce: payload.nonce,
      redirectTo: payload.redirectTo,
    };
  } catch {
    return undefined;
  }
}
