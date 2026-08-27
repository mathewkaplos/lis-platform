import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  SESSION_TOKENS_COOKIE_NAME,
  verifySession,
  type SessionPayload,
} from './session';

export async function getSession(): Promise<SessionPayload | undefined> {
  const cookieStore = await cookies();
  return verifySession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(SESSION_TOKENS_COOKIE_NAME)?.value,
  );
}
