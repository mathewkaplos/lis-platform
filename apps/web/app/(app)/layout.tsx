import { cookies } from 'next/headers';
import { getSession } from '@/auth/get-session';
import { THEME_COOKIE_NAME, isTheme } from '@/lib/theme';
import { Sidebar } from './_components/sidebar';
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

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar
          tenantId={session.tenantId}
          userSub={session.sub}
          theme={isTheme(themeCookie) ? themeCookie : undefined}
        />
        <main className="flex-1 overflow-y-auto p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
