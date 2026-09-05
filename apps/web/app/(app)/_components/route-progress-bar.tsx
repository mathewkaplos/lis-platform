'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Issue #805: `/patients` and `/orders` had their own `loading.tsx` deleted
 * (docs/pilot/PILOT-USER-GUIDE.md §7/§8) to fix a real Suspense-boundary
 * hang under `next dev --webpack` -- correct fix, but it left every route
 * navigation with zero visual feedback while the next page renders
 * (confirmed live, 3-4s of a frozen-looking prior page --
 * docs/ux-responsiveness-audit-2026-09-05.md §3.2). This component is
 * deliberately NOT a per-route Suspense boundary -- it's a plain client
 * component mounted once in the shared app shell (`layout.tsx`), so it
 * structurally cannot reproduce that hang: a `document`-level click
 * listener shows the bar on any internal link click, and a
 * `usePathname`/`useSearchParams`-keyed effect clears it once the new
 * route has actually committed.
 *
 * Keyed on `usePathname()` alone, not `useSearchParams()` -- the latter
 * would require this component to sit inside its own `<Suspense>` boundary
 * to satisfy Next.js's static-generation rules for that hook (a real
 * production-build requirement, not a dev-only lint nag), and issue #805's
 * own reproduction is a plain pathname change (a sidebar nav click).
 * Skipping it keeps this component free of any Suspense involvement at
 * all, which is the whole point given what removing a Suspense-based
 * `loading.tsx` was fixing in the first place (§7/§8 above).
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const previousPathnameRef = useRef(pathname);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The route actually changed -- the navigation this bar was showing for
  // has committed.
  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      setVisible(false);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    }
  }, [pathname]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank') return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        // No href, a same-page anchor, or an absolute URL (http(s):, mailto:,
        // tel:, ...) -- none of these are an in-app route navigation.
        return;
      }
      if (href === pathname) return;

      setVisible(true);
      // Safety net: a click that doesn't actually result in a route commit
      // (blocked navigation, an error before render, a link to the current
      // route) must not leave the bar stuck visible forever.
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = setTimeout(() => setVisible(false), 8000);
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-x-0 top-0 z-50 h-1 animate-pulse bg-primary"
    />
  );
}
