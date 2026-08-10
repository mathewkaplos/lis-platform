import Link from 'next/link';
import { getSession } from '@/auth/get-session';

/**
 * FEAT-038 (proposal §2/§5): the clinician portal's own minimal shell, same
 * shape as `(portal)/layout.tsx` (FEAT-039) -- no staff `Sidebar`/`TopBar`.
 * `proxy.ts` only enforces "authenticated at all"; this layout is the UI
 * gate (the API's own `place_order_own_patient`/`view_related_patient_
 * results`/`acknowledge_critical_own_patient` capabilities are the real
 * security boundary, per KB-10's "server decides, UI hides" principle).
 */
export default async function ClinicianLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <a href="/api/auth/login" className="underline">
          Log in
        </a>
      </div>
    );
  }

  if (!session.roles.includes('clinician')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-background text-center">
        <p className="text-sm text-foreground">
          This area is only available to clinician accounts.
        </p>
        <a href="/api/auth/logout" className="text-sm underline">
          Log out
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href="/clinician" className="text-lg font-semibold text-foreground">
          Doctor Dashboard
        </Link>
        <a href="/api/auth/logout" className="text-sm text-text-secondary underline">
          Log out
        </a>
      </header>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
