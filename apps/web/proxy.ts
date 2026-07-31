import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/auth/session';

export const config = {
  // Excludes /api/auth/* (login/callback/logout must be reachable while
  // unauthenticated) and Next's own static/internal assets. Everything else
  // in the app is treated as protected -- there is no public page at this
  // milestone (FEAT-008 is M2's entry point, before any clinical content).
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
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
