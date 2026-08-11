'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE_NAME, type Locale } from '@/lib/locale';

// FEAT-048 (ADR-0043). Mirrors set-theme.ts's exact shape -- one year, same
// as the theme cookie's own precedent (a user's language choice shouldn't
// need re-picking on every visit).
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
}
