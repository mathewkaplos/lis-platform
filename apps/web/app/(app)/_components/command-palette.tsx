'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import {
  SlideOver,
  SlideOverContent,
  SlideOverHeader,
  SlideOverTitle,
  SlideOverDescription,
} from '@lis/ui';

// A genuine stub per FEAT-010's own AC text ("command palette stub") -- no
// command registry or search logic exists yet. Real command search is a
// future task once there's more than one route to search across.
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-accent"
      >
        <Search className="size-4" />
        Search...
        {/* Handler accepts both Ctrl+K and Cmd+K; Ctrl+K label shown since it's the
            functional key on every platform (Mac's Cmd+K also works via the metaKey
            check above) -- avoids a client-only platform-detection effect for a stub. */}
        <kbd className="ml-4 rounded border border-border px-1 font-mono text-xs">Ctrl+K</kbd>
      </button>
      <SlideOver open={open} onOpenChange={setOpen}>
        <SlideOverContent side="top" className="mx-auto mt-24 h-fit max-w-xl rounded-lg border">
          <SlideOverHeader>
            <SlideOverTitle>Command palette</SlideOverTitle>
            <SlideOverDescription>Coming soon</SlideOverDescription>
          </SlideOverHeader>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <Search className="size-4 text-text-muted" />
            <input
              disabled
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-text-muted outline-none placeholder:text-text-muted"
            />
          </div>
        </SlideOverContent>
      </SlideOver>
    </>
  );
}
