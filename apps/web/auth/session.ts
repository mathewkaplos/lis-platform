import { jwtVerify, SignJWT } from 'jose';
import { getSessionSecret } from './secret';

export const SESSION_COOKIE_NAME = 'lis_session';
// Issue found live during the pilot-readiness pass, 2026-08-27: a session
// carrying all three real Keycloak tokens (id/access/refresh) as one JWT,
// for a user holding several realm roles (e.g. a fresh self-signup
// `lab_admin`, whose token set includes the `default-roles-lis` composite --
// `offline_access` + `uma_authorization` -- on top of `lab_admin` itself,
// unlike this realm's own hand-authored seed users in lis-realm.json, which
// don't carry that composite), pushed the single cookie's value past ~4200
// bytes -- over the ~4096-byte per-cookie limit browsers silently enforce
// (RFC 6265's recommended minimum; Chrome does not error, it just never
// stores the cookie). The result was a real, reproducible infinite login
// redirect loop: the callback route believed it had set a valid session
// (its own response looked correct, no error logged anywhere), but the
// browser never actually stored `lis_session`, so the very next request hit
// proxy.ts's "no session" branch, redirected to /api/auth/login, and
// Keycloak's still-active SSO session silently re-issued a fresh
// authorization code with no form to fill in -- looping forever with a
// different code each time until Chrome gave up with ERR_TOO_MANY_REDIRECTS.
// Confirmed via a byte-for-byte accounting of one real captured cookie:
// idToken 1139 + accessToken 1037 + refreshToken 617 chars (already
// base64), plus this JWT's own header/signature/JSON-key overhead, totaled
// 4204 bytes for the cookie value alone.
//
// Fix: split the session across two cookies instead of widening any single
// limit -- `SESSION_COOKIE_NAME` keeps only the small, frequently-read
// claims (sub/tenantId/roles/accessTokenExpiresAt), and the three real
// tokens move to their own `SESSION_TOKENS_COOKIE_NAME` cookie. Each token
// individually (617-1139 bytes) is well under the per-cookie limit even
// with JWT overhead, so this fix has real headroom, not just enough to
// clear today's one observed case -- a role set with a few more composite
// roles won't immediately reintroduce the same failure the way further
// growing one cookie would have.
export const SESSION_TOKENS_COOKIE_NAME = 'lis_session_tokens';

// Matches the realm's ssoSessionIdleTimeout (1800s) --
// infra/keycloak/lis-realm.json -- rather than an arbitrary separate value.
const SESSION_TTL = '30m';
export const SESSION_MAX_AGE_SECONDS = 1800;

/**
 * apps/web's own session -- never exposed to browser JS (both cookies below
 * are httpOnly). idToken is retained solely to hint RP-initiated logout.
 *
 * accessToken/refreshToken/accessTokenExpiresAt (ADR-0014): the real
 * Keycloak-issued tokens, retained so a Server Action/Route Handler can call
 * apps/api on the user's behalf. Never read directly by a caller -- always
 * through getValidAccessToken() (auth/access-token.ts), which refreshes
 * accessToken via refreshToken before it's stale (the realm's
 * accessTokenLifespan is 300s, far shorter than this session's own 30-minute
 * lifetime).
 *
 * Split at rest (see SESSION_TOKENS_COOKIE_NAME's own comment above) across
 * SESSION_COOKIE_NAME (core) and SESSION_TOKENS_COOKIE_NAME (tokens) --
 * this interface is the one shape every caller still works with; the split
 * is an internal storage detail signSession()/verifySession() hide.
 */
export interface SessionPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

/** The two cookies signSession() produces -- callers set both together,
 * under SESSION_COOKIE_NAME and SESSION_TOKENS_COOKIE_NAME respectively. */
export interface SignedSessionCookies {
  core: string;
  tokens: string;
}

// Session and PKCE-state tokens share one secret (see secret.ts) -- this
// audience is what keeps the two token types from being interchangeable.
// Without it, a PKCE cookie (obtainable by any anonymous visitor just by
// hitting /api/auth/login) would verify successfully if copied into the
// session cookie slot, since both are just HS256 JWTs over the same key.
// The tokens half of a split session reuses this same audience (not a third
// value) -- it's still exactly as sensitive as the old single session
// cookie was, just stored separately, so it needs the same protection, not
// a different one.
const SESSION_AUDIENCE = 'lis:session';

interface SessionCoreClaims {
  sub: string;
  tenantId: string;
  roles: string[];
  accessTokenExpiresAt: number;
}

interface SessionTokenClaims {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

export async function signSession(
  payload: SessionPayload,
): Promise<SignedSessionCookies> {
  const core: SessionCoreClaims = {
    sub: payload.sub,
    tenantId: payload.tenantId,
    roles: payload.roles,
    accessTokenExpiresAt: payload.accessTokenExpiresAt,
  };
  const tokens: SessionTokenClaims = {
    idToken: payload.idToken,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  };
  const [coreJwt, tokensJwt] = await Promise.all([
    new SignJWT({ ...core })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .setAudience(SESSION_AUDIENCE)
      .sign(getSessionSecret()),
    new SignJWT({ ...tokens })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .setAudience(SESSION_AUDIENCE)
      .sign(getSessionSecret()),
  ]);
  return { core: coreJwt, tokens: tokensJwt };
}

/**
 * Verifies and merges both halves of a split session. Either cookie missing
 * or failing verification independently fails the whole session closed --
 * a core-only or tokens-only session is never a valid partial state (mirrors
 * every other fail-closed check in this file; a caller with one intact
 * cookie and one expired/tampered one gets the same "log in again" outcome
 * as a caller with neither).
 */
export async function verifySession(
  coreToken: string | undefined,
  tokensToken: string | undefined,
): Promise<SessionPayload | undefined> {
  if (!coreToken || !tokensToken) {
    return undefined;
  }
  try {
    const [{ payload: core }, { payload: tokens }] = await Promise.all([
      jwtVerify<SessionCoreClaims>(coreToken, getSessionSecret(), {
        audience: SESSION_AUDIENCE,
      }),
      jwtVerify<SessionTokenClaims>(tokensToken, getSessionSecret(), {
        audience: SESSION_AUDIENCE,
      }),
    ]);
    // Belt and suspenders on top of the audience check: never return an
    // object proxy.ts's `if (session)` would treat as authenticated unless
    // every field is actually shaped like a real session.
    if (
      typeof core.sub !== 'string' ||
      core.sub.length === 0 ||
      typeof core.tenantId !== 'string' ||
      core.tenantId.length === 0 ||
      !Array.isArray(core.roles) ||
      !core.roles.every((role) => typeof role === 'string') ||
      typeof core.accessTokenExpiresAt !== 'number' ||
      typeof tokens.idToken !== 'string' ||
      typeof tokens.accessToken !== 'string' ||
      tokens.accessToken.length === 0 ||
      typeof tokens.refreshToken !== 'string' ||
      tokens.refreshToken.length === 0
    ) {
      return undefined;
    }
    return {
      sub: core.sub,
      tenantId: core.tenantId,
      roles: core.roles,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: core.accessTokenExpiresAt,
    };
  } catch {
    return undefined;
  }
}

/** Shape both `next/headers` `cookies()` and a `NextResponse`'s own
 * `.cookies` expose -- lets setSessionCookies()/clearSessionCookies() below
 * work identically from a Route Handler (response.cookies) and from a plain
 * Server Component/Server Action (cookies() from next/headers), the two
 * places this file's own callers set/clear the session today. */
interface CookieWriter {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax';
      path: string;
      maxAge: number;
    },
  ): unknown;
  delete(name: string): unknown;
}

export function setSessionCookies(
  cookieWriter: CookieWriter,
  signed: SignedSessionCookies,
): void {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
  cookieWriter.set(SESSION_COOKIE_NAME, signed.core, options);
  cookieWriter.set(SESSION_TOKENS_COOKIE_NAME, signed.tokens, options);
}

export function clearSessionCookies(cookieWriter: CookieWriter): void {
  cookieWriter.delete(SESSION_COOKIE_NAME);
  cookieWriter.delete(SESSION_TOKENS_COOKIE_NAME);
}
