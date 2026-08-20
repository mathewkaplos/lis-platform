'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@lis/ui';

// The (app) layout persists across client-side navigation within the route
// group, so the Sheet's own open/closed state would otherwise survive a link
// tap and leave the drawer open over the next page -- Radix has no
// on-navigate-close behavior of its own. Closing on pathname change is the
// fix (issue #240, docs/plans/task-240-mobile-nav.md §5.2), done during
// render (React's own documented "adjusting state when a prop changes"
// pattern -- https://react.dev/learn/you-might-not-need-an-effect) rather
// than in a useEffect, which `react-hooks/set-state-in-effect` rejects here
// as an unconditional setState-in-effect.
//
// The trigger button is wrapped in a real `SheetTrigger` (not a plain
// onClick calling setOpen(true)) so Radix's own Dialog can track it as the
// element to restore focus to on close -- confirmed via a real Playwright
// pass that a manually-controlled `onClick`-only button left focus nowhere
// in particular after Escape, while `SheetTrigger asChild` restores it
// correctly.
export function MobileNavTrigger({
  triggerLabel,
  title,
  children,
}: {
  triggerLabel: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={triggerLabel} className="sm:hidden">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-3/4 max-w-xs">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1 px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
