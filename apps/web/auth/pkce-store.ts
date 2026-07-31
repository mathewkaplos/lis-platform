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

export async function signPkceState(payload: PkceState): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(PKCE_TTL)
    .sign(SESSION_SECRET);
}

export async function verifyPkceState(
  token: string,
): Promise<PkceState | undefined> {
  try {
    const { payload } = await jwtVerify<PkceState>(token, SESSION_SECRET);
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
