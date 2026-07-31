import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getOidcConfig } from '@/auth/oidc-config';
import { PKCE_COOKIE_NAME, PKCE_MAX_AGE_SECONDS, signPkceState } from '@/auth/pkce-store';
import { sanitizeRedirectPath } from '@/auth/safe-redirect';

export async function GET(request: NextRequest) {
  const config = await getOidcConfig();

  // PKCE + state + nonce must all be freshly generated per authorization
  // request, never reused -- see openid-client's own Authorization Code +
  // PKCE guidance.
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const redirectTo = sanitizeRedirectPath(
    request.nextUrl.searchParams.get('rd'),
  );
  const callbackUrl = new URL('/api/auth/callback', request.nextUrl.origin);

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl.href,
    scope: 'openid tenant',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  const pkceCookie = await signPkceState({
    codeVerifier,
    state,
    nonce,
    redirectTo,
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(PKCE_COOKIE_NAME, pkceCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: PKCE_MAX_AGE_SECONDS,
  });
  return response;
}
