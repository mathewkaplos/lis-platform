import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/locale';

// FEAT-048 (ADR-0043): "without i18n routing" mode -- the locale is read
// from a cookie (the same mechanism lib/theme.ts already established for
// dark mode), never from a `[locale]` URL segment. No `next-intl`
// routing/middleware helper is used anywhere in this app.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
