import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySession } from '@/auth/session';

export default async function Home() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionCookie
    ? await verifySession(sessionCookie)
    : undefined;

  // proxy.ts is the actual access control -- it never lets an
  // unauthenticated request reach this page. This guard is defensive only
  // (e.g. a session that expires in the moment between the proxy's own
  // check and this render), not the primary gate.
  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <a href="/api/auth/login" className="underline">
          Log in
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Signed in
      </h1>
      <dl className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex gap-2">
          <dt className="font-medium">User:</dt>
          <dd>{session.sub}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Tenant:</dt>
          <dd>{session.tenantId}</dd>
        </div>
      </dl>
      <a
        href="/api/auth/logout"
        className="rounded-full border border-solid border-black/[.08] px-5 py-2 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
      >
        Log out
      </a>
    </div>
  );
}
