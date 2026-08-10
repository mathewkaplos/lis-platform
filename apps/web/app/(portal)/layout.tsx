import { getSession } from '@/auth/get-session';

/**
 * FEAT-039 (proposal §5): the patient portal's own minimal shell -- no
 * staff `Sidebar`/`TopBar` (`(app)/layout.tsx`'s own shell is built for
 * the lab-staff persona: Orders/Patients/Specimens/Reception/QC nav that
 * would be actively wrong to show a patient). Still the same Next.js app
 * (no separate deployment, per proposal §5's own "no new app" reading of
 * the issue's "no new UI" framing) -- just a different route group with
 * its own layout.
 *
 * `proxy.ts` only enforces "authenticated at all," not role -- this layout
 * is the actual `patient`-role gate for the UI (the API's own
 * `view_own_results` capability is the real security boundary regardless;
 * this is UX, not the enforcement point, per KB-10's "server decides, UI
 * hides" principle).
 */
export default async function PortalLayout({
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

  if (!session.roles.includes('patient')) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-background text-center">
        <p className="text-sm text-foreground">
          This area is only available to patient portal accounts.
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
        <span className="text-lg font-semibold text-foreground">My Results</span>
        <a href="/api/auth/logout" className="text-sm text-text-secondary underline">
          Log out
        </a>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
