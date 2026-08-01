import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from './session';

export async function getSession(): Promise<SessionPayload | undefined> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return sessionCookie ? verifySession(sessionCookie) : undefined;
}
