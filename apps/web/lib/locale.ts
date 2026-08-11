// FEAT-048 (ADR-0043). Mirrors lib/theme.ts's exact shape (constants + a
// type guard only -- never colocated with the 'use server' action file,
// per `frontend-design` entry #8).

export const LOCALE_COOKIE_NAME = 'lis_locale';

export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string | undefined): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '');
}
