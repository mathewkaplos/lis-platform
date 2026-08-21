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
      <div className="flex flex-1 flex-col">
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
          className="flex-1 overflow-y-auto p-6 outline-none print:p-0"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
