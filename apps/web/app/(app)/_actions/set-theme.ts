'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE_NAME, type Theme } from '@/lib/theme';

// One year -- a user's theme choice shouldn't need re-picking on every
// visit, unlike the session cookie's short-lived SESSION_MAX_AGE_SECONDS.
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function setTheme(theme: Theme): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, theme, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
}
