import { cookies } from 'next/headers';
import * as client from 'openid-client';
import { getOidcConfig } from './oidc-config';
import { getSession } from './get-session';
import {
  clearSessionCookies,
  setSessionCookies,
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
 * tokens when it can.
 *
 * Safe to call from a plain (GET) Server Component render, not just a Server
 * Action/Route Handler -- found for real, not hypothetical, by TASK-041's own
 * browser verification of its two new read-only screens: `cookies().set(...)`
 * throws ("Cookies can only be modified in a Server Action or Route
 * Handler") once the access token actually goes stale mid-render, which a
 * long-lived search/profile session will always eventually hit. When that
 * write fails, the refreshed access token is still returned for this
 * request -- just not persisted -- and the *next* call re-refreshes from the
 * same still-valid `refreshToken` (Keycloak's default `revokeRefreshToken:
 * false` means it isn't single-use, so this is safe, just an extra round
 * trip until a real Server Action/Route Handler call persists a refresh).
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

    try {
      const signedSession = await signSession({ ...session, ...refreshed });
      const cookieStore = await cookies();
      setSessionCookies(cookieStore, signedSession);
    } catch {
      // Called from a plain Server Component render -- no response left to
      // attach a Set-Cookie header to. The refreshed token below is still
      // good for this request; see this function's own header comment.
    }

    return refreshed.accessToken;
  } catch {
    // Refresh token expired/revoked, or Keycloak unreachable -- fail closed,
    // never retry indefinitely or return a stale/invalid token.
    try {
      const cookieStore = await cookies();
      clearSessionCookies(cookieStore);
    } catch {
      // Same plain-render restriction as above -- nothing to delete from
      // this request's own response either; the next Server Action/Route
      // Handler call will hit the same failure and clear it for real.
    }
    return undefined;
  }
}
