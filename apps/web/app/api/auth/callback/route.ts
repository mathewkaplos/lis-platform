import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getOidcConfig } from '@/auth/oidc-config';
import { PKCE_COOKIE_NAME, verifyPkceState } from '@/auth/pkce-store';
import { getPublicOrigin } from '@/auth/public-origin';
import { setSessionCookies, signSession } from '@/auth/session';

interface LisIdTokenClaims {
  sub: string;
  tenant_id?: unknown;
  realm_access?: { roles?: unknown };
}

function toLoginRedirect(origin: string): NextResponse {
  const response = NextResponse.redirect(new URL('/api/auth/login', origin));
  // The verifier/state/nonce in this cookie are single-use -- a failed
  // exchange must not leave them behind for a second attempt to replay.
  response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });
  return response;
}

export async function GET(request: NextRequest) {
  const pkceCookie = request.cookies.get(PKCE_COOKIE_NAME)?.value;
  const pkceState = pkceCookie ? await verifyPkceState(pkceCookie) : undefined;

  if (!pkceState) {
    // Expired, missing, or tampered -- never proceed with a token exchange
    // that has no verified state/nonce/code_verifier to check the IdP's
    // response against.
    console.error(
      '[auth/callback] missing/invalid PKCE state cookie -- redirecting to login',
    );
    return toLoginRedirect(getPublicOrigin(request));
  }

  let config: Awaited<ReturnType<typeof getOidcConfig>>;
  try {
    config = await getOidcConfig();
  } catch (err) {
    // Previously uncaught here -- a discovery failure (Keycloak unreachable,
    // DNS, etc.) crashed the route with no server-side trace at all. Same
    // fail-closed redirect as every other failure path, but now logged.
    console.error('[auth/callback] getOidcConfig() failed:', err);
    return toLoginRedirect(getPublicOrigin(request));
  }

  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, request, {
      pkceCodeVerifier: pkceState.codeVerifier,
      expectedState: pkceState.state,
      expectedNonce: pkceState.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    // Bad/expired code, state/nonce mismatch, or the user denied consent --
    // all collapse to "log in again," never a partially-authenticated state.
    // Logged (not just swallowed) so this class of failure is diagnosable --
    // confirmed 2026-08-03 this route previously gave zero server-side trace
    // for a real staging login failure.
    console.error('[auth/callback] authorizationCodeGrant() failed:', err);
    return toLoginRedirect(getPublicOrigin(request));
  }

  const claims = tokens.claims() as LisIdTokenClaims | undefined;
  if (
    !claims ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    typeof claims.tenant_id !== 'string' ||
    claims.tenant_id.length === 0
  ) {
    // Same fail-closed rule apps/api's JwtAuthGuard applies (TASK-029): a
    // token that can't resolve a tenant is not a valid session, full stop.
    console.error(
      '[auth/callback] token missing sub/tenant_id claim -- claims:',
      claims,
    );
    return toLoginRedirect(getPublicOrigin(request));
  }

  const roles = Array.isArray(claims.realm_access?.roles)
    ? (claims.realm_access.roles as string[])
    : [];

  const signedSession = await signSession({
    sub: claims.sub,
    tenantId: claims.tenant_id,
    roles,
    idToken: tokens.id_token ?? '',
    // ADR-0014: retained so apps/web can call apps/api on the user's behalf
    // (getValidAccessToken(), auth/access-token.ts) -- previously discarded
    // here entirely.
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    accessTokenExpiresAt:
      Math.floor(Date.now() / 1000) + (tokens.expiresIn() ?? 0),
  });

  const response = NextResponse.redirect(
    new URL(pkceState.redirectTo, getPublicOrigin(request)),
  );
  setSessionCookies(response.cookies, signedSession);
  response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });
  return response;
}
