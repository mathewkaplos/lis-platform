'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lis/ui';
import { setLocale } from '../_actions/set-locale';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locale';

// FEAT-048 (ADR-0043). A dropdown, not a two-state toggle like ThemeToggle
// -- SUPPORTED_LOCALES already has more than two values from day one.
// Mirrors ThemeToggle's useTransition + router.refresh() shape exactly.
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
};

export function LocaleSelect({ current }: { current: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change language" disabled={isPending}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            disabled={locale === current}
            onSelect={() =>
              startTransition(async () => {
                await setLocale(locale);
                router.refresh();
              })
            }
          >
            {LOCALE_LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
