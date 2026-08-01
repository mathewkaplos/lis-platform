'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@lis/ui';
import { setTheme } from '../_actions/set-theme';
import type { Theme } from '@/lib/theme';

// TASK-036 AC only requires the choice to persist -- a two-state light/dark
// toggle (not a three-way Light/Dark/System picker) is the minimal shape
// that satisfies it; "System" is just "no cookie set yet", the state this
// toggle moves *away* from on first click, not a state it needs to return to.
export function ThemeToggle({ current }: { current: Theme | undefined }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: Theme = current === 'dark' ? 'light' : 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Switch to ${next} theme`}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setTheme(next);
          router.refresh();
        })
      }
    >
      {current === 'dark' ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
