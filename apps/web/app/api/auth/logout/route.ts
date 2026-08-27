import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getOidcConfig } from '@/auth/oidc-config';
import { getPublicOrigin } from '@/auth/public-origin';
import {
  clearSessionCookies,
  SESSION_COOKIE_NAME,
  SESSION_TOKENS_COOKIE_NAME,
  verifySession,
} from '@/auth/session';

export async function GET(request: NextRequest) {
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
    request.cookies.get(SESSION_TOKENS_COOKIE_NAME)?.value,
  );

  if (!session?.idToken) {
    // No session (or no id_token to hint the IdP with) -- nothing to end at
    // Keycloak; clearing our own cookie is already a complete local logout.
    const response = NextResponse.redirect(
      new URL('/api/auth/login', getPublicOrigin(request)),
    );
    clearSessionCookies(response.cookies);
    return response;
  }

  const config = await getOidcConfig();
  // post.logout.redirect.uris is set to "+" on lis-web in lis-realm.json,
  // meaning Keycloak accepts anything already in its Valid Redirect URIs --
  // required as of Keycloak 19+, RP-Initiated Logout otherwise rejects the
  // redirect outright.
  const endSessionUrl = client.buildEndSessionUrl(config, {
    id_token_hint: session.idToken,
    post_logout_redirect_uri: new URL('/', getPublicOrigin(request)).href,
  });

  const response = NextResponse.redirect(endSessionUrl);
  clearSessionCookies(response.cookies);
  return response;
}
