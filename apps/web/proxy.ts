import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/auth/session';

export const config = {
  // Excludes /api/auth/* (login/callback/logout must be reachable while
  // unauthenticated), /signup (FEAT-049's own self-service onboarding page
  // -- the first real public page in this app; a route group like
  // `(public)` is purely organizational and invisible to this matcher, per
  // `frontend-design` entry #9's own "parens don't affect the URL" lesson,
  // which applies here too -- confirmed live: /signup 307-redirected to
  // /api/auth/login until added here explicitly), and Next's own
  // static/internal assets. Everything else in the app is treated as
  // protected.
  matcher: ['/((?!api/auth|signup|_next/static|_next/image|favicon.ico).*)'],
};

export async function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionCookie
    ? await verifySession(sessionCookie)
    : undefined;

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/api/auth/login', request.nextUrl.origin);
  loginUrl.searchParams.set('rd', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}
