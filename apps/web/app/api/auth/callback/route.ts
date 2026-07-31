import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getOidcConfig } from '@/auth/oidc-config';
import { PKCE_COOKIE_NAME, verifyPkceState } from '@/auth/pkce-store';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSession,
} from '@/auth/session';

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
    return toLoginRedirect(request.nextUrl.origin);
  }

  const config = await getOidcConfig();

  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, request, {
      pkceCodeVerifier: pkceState.codeVerifier,
      expectedState: pkceState.state,
      expectedNonce: pkceState.nonce,
      idTokenExpected: true,
    });
  } catch {
    // Bad/expired code, state/nonce mismatch, or the user denied consent --
    // all collapse to "log in again," never a partially-authenticated state.
    return toLoginRedirect(request.nextUrl.origin);
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
    return toLoginRedirect(request.nextUrl.origin);
  }

  const roles = Array.isArray(claims.realm_access?.roles)
    ? (claims.realm_access.roles as string[])
    : [];

  const sessionCookie = await signSession({
    sub: claims.sub,
    tenantId: claims.tenant_id,
    roles,
    idToken: tokens.id_token ?? '',
  });

  const response = NextResponse.redirect(
    new URL(pkceState.redirectTo, request.nextUrl.origin),
  );
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.delete({ name: PKCE_COOKIE_NAME, path: '/api/auth' });
  return response;
}
