import { getSession } from '@/auth/get-session';

// The auth guard now lives in this route group's layout.tsx (renders on
// every authenticated route, not just this one) -- this page only needs its
// own content.
export default async function Home() {
  const session = await getSession();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Signed in</h1>
      <dl className="space-y-1 text-sm text-text-secondary">
        <div className="flex gap-2">
          <dt className="font-medium">User:</dt>
          <dd>{session?.sub}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Tenant:</dt>
          <dd>{session?.tenantId}</dd>
        </div>
      </dl>
    </div>
  );
}
