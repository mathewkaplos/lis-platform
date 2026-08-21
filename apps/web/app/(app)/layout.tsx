import { cookies } from 'next/headers';
import { getSession } from '@/auth/get-session';
import { THEME_COOKIE_NAME, isTheme } from '@/lib/theme';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/locale';
import { MobileTopNav, Sidebar } from './_components/sidebar';
import { TopBar } from './_components/top-bar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // proxy.ts is the actual access control -- it never lets an
  // unauthenticated request reach this layout. This guard is defensive only
  // (e.g. a session that expires in the moment between the proxy's own
  // check and this render), not the primary gate.
  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <a href="/api/auth/login" className="underline">
          Log in
        </a>
      </div>
    );
  }

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const localeCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  return (
    <div className="flex min-h-full flex-1">
      {/* Issue #717 (EPIC #697): a keyboard-only user otherwise tabs through the
          entire sidebar nav (14 links) plus the mobile-nav trigger and every
          TopBar control before ever reaching page content -- on every single
          page load, since the sidebar/topbar are shared shell chrome, not
          per-page. Standard WCAG 2.4.1 "Bypass Blocks" pattern: visually
          hidden until focused, first in tab order. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <Sidebar />
      {/* Issue #713 (EPIC #697), live-verified follow-up: a flex item's default
          min-width is `auto`, which means it won't shrink below its content's
          intrinsic width -- without `min-w-0` here, any deeply-nested wide
          content (e.g. the dashboard worklist table, which already has its own
          `overflow-x-auto` wrapper) forces THIS column, and every ancestor up
          to the page body, to grow to fit it instead of letting that nested
          wrapper scroll internally. Confirmed live: without this, a narrow
          viewport rendered the whole page ~4.5x wider than the actual
          viewport. The classic, well-documented Flexbox "min-width: auto"
          trap -- not visible from a static Tailwind-class read, only from an
          actual narrow-viewport render, which is why the earlier code-only
          audit for #713 missed it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopNav />
        <TopBar
          tenantId={session.tenantId}
          userSub={session.sub}
          theme={isTheme(themeCookie) ? themeCookie : undefined}
          locale={isLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto p-6 outline-none print:p-0"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
