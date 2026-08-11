import { LogOut } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lis/ui';
import type { Theme } from '@/lib/theme';
import type { Locale } from '@/lib/locale';
import { CommandPalette } from './command-palette';
import { LocaleSelect } from './locale-select';
import { ThemeToggle } from './theme-toggle';

export function TopBar({
  tenantId,
  userSub,
  theme,
  locale,
}: {
  tenantId: string;
  userSub: string;
  theme: Theme | undefined;
  locale: Locale;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 print:hidden">
      <CommandPalette />
      <div className="flex items-center gap-2">
        {/* Static per the approved TASK-036 proposal (§10): no org/branch data model exists
            yet, so this is a label, not a switcher -- see docs/plans/feat-010-design-system-v1.md. */}
        <span className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary">
          {tenantId}
        </span>
        <LocaleSelect current={locale} />
        <ThemeToggle current={theme} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="User menu">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs font-medium text-white">
                {userSub.slice(0, 1).toUpperCase()}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href="/api/auth/logout" className="flex items-center gap-2">
                <LogOut className="size-4" />
                Log out
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
