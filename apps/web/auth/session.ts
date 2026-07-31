import { jwtVerify, SignJWT } from 'jose';
import { SESSION_SECRET } from './secret';

export const SESSION_COOKIE_NAME = 'lis_session';

// Matches the realm's ssoSessionIdleTimeout (1800s) --
// infra/keycloak/lis-realm.json -- rather than an arbitrary separate value.
const SESSION_TTL = '30m';
export const SESSION_MAX_AGE_SECONDS = 1800;

/**
 * apps/web's own session -- never the raw Keycloak access token exposed to
 * browser JS (this is only ever read/written server-side; the cookie itself
 * is httpOnly). idToken is retained solely to hint RP-initiated logout.
 */
export interface SessionPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  idToken: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(SESSION_SECRET);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | undefined> {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, SESSION_SECRET);
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      roles: payload.roles,
      idToken: payload.idToken,
    };
  } catch {
    return undefined;
  }
}
