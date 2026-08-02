import { cookies } from 'next/headers';
import * as client from 'openid-client';
import { getOidcConfig } from './oidc-config';
import { getSession } from './get-session';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  type SessionPayload,
} from './session';

// ADR-0014: refresh a bit before actual expiry, not exactly at it -- avoids
// a request racing the token's last valid second against apps/api's own
// clock skew.
const REFRESH_BUFFER_SECONDS = 30;

export type RefreshableSession = Pick<
  SessionPayload,
  'accessToken' | 'refreshToken' | 'accessTokenExpiresAt'
>;

/**
 * The actual refresh decision + Keycloak call, isolated from Next.js's
 * request-scoped `cookies()` (which throws outside a Server Action/Route
 * Handler, per Next.js's own docs -- see `getValidAccessToken`'s comment) so
 * this real, network-calling logic is directly testable against a real
 * Keycloak instance without needing a mocked Next.js request context.
 *
 * Returns `null` when the current token is still comfortably valid (no
 * refresh needed). Throws on a genuine refresh failure (expired refresh
 * token, revoked session, Keycloak unreachable) -- the caller decides what
 * "fail closed" means for its own context.
 */
export async function refreshIfStale(
  session: RefreshableSession,
  config: client.Configuration,
  now: number = Math.floor(Date.now() / 1000),
): Promise<RefreshableSession | null> {
  if (session.accessTokenExpiresAt - REFRESH_BUFFER_SECONDS > now) {
    return null;
  }

  const tokens = await client.refreshTokenGrant(config, session.refreshToken);

  return {
    accessToken: tokens.access_token,
    // Keycloak may or may not rotate the refresh token on each grant --
    // always store whichever one actually comes back (ADR-0014 §4), never
    // silently keep reusing the old one.
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    accessTokenExpiresAt: now + (tokens.expiresIn() ?? 0),
  };
}

/**
 * The one sanctioned way to obtain a bearer token for calling apps/api
 * (ADR-0014). Refreshes server-side via `refreshIfStale` when the current
 * access token is stale or within `REFRESH_BUFFER_SECONDS` of expiring (the
 * realm's `accessTokenLifespan` is 300s, far shorter than this session's own
 * 30-minute lifetime), re-persisting the session cookie with the refreshed
 * tokens.
 *
 * Only callable from a Server Action or Route Handler -- `cookies().set(...)`
 * (called here on refresh) throws outside that context, since mutating
 * cookies during a plain Server Component render has no HTTP response left
 * to attach a Set-Cookie header to.
 *
 * Returns undefined when there is no session at all, or when the refresh
 * itself fails (expired refresh token, revoked session, Keycloak
 * unreachable) -- the same fail-closed posture callback/route.ts already
 * applies to a failed authorization-code exchange. Callers already have an
 * established "no session" path (every existing authenticated page checks
 * getSession()'s own possible undefined); this mirrors that.
 */
export async function getValidAccessToken(): Promise<string | undefined> {
  const session = await getSession();
  if (!session) {
    return undefined;
  }

  try {
    const config = await getOidcConfig();
    const refreshed = await refreshIfStale(session, config);
    if (!refreshed) {
      return session.accessToken;
    }

    const sessionCookie = await signSession({ ...session, ...refreshed });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return refreshed.accessToken;
  } catch {
    // Refresh token expired/revoked, or Keycloak unreachable -- fail closed,
    // never retry indefinitely or return a stale/invalid token.
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return undefined;
  }
}
