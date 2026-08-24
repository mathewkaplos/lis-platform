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
  orgName,
  userSub,
  theme,
  locale,
}: {
  tenantId: string;
  /** Pilot-readiness audit fix (P1): the real org name (`tenant.name`, via
   * `/v1/org-settings`), once #706 gave this badge something better to show
   * than the raw tenant id TASK-036's own original proposal (§10) used as a
   * placeholder. `null` when org-settings couldn't be read -- falls back
   * to the original id label, never a blank badge. */
  orgName: string | null;
  userSub: string;
  theme: Theme | undefined;
  locale: Locale;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 print:hidden">
      <CommandPalette />
      <div className="flex items-center gap-2">
        {/* Still a label, not a switcher (TASK-036 proposal §10) -- no
            org/branch data model beyond a single name exists yet.
            Issue #713 (EPIC #697): hidden below `sm` -- this row's own
            controls overflow a real mobile viewport with no wrap/shrink
            handling here, and neither the org name nor the raw id has much
            value to a pilot user on a phone. */}
        <span
          className="hidden max-w-48 truncate rounded-md border border-border px-2 py-1 text-xs text-text-secondary sm:inline-block"
          title={orgName ?? tenantId}
        >
          {orgName ?? tenantId}
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
