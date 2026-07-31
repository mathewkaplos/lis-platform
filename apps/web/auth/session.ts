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

// Session and PKCE-state tokens share one secret (see secret.ts) -- this
// audience is what keeps the two token types from being interchangeable.
// Without it, a PKCE cookie (obtainable by any anonymous visitor just by
// hitting /api/auth/login) would verify successfully if copied into the
// session cookie slot, since both are just HS256 JWTs over the same key.
const SESSION_AUDIENCE = 'lis:session';

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .setAudience(SESSION_AUDIENCE)
    .sign(SESSION_SECRET);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | undefined> {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, SESSION_SECRET, {
      audience: SESSION_AUDIENCE,
    });
    // Belt and suspenders on top of the audience check: never return an
    // object proxy.ts's `if (session)` would treat as authenticated unless
    // every field is actually shaped like a real session.
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.tenantId !== 'string' ||
      payload.tenantId.length === 0 ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role) => typeof role === 'string') ||
      typeof payload.idToken !== 'string'
    ) {
      return undefined;
    }
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
