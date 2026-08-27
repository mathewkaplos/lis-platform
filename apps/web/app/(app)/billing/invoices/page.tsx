import Link from 'next/link';
import { Button } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { InvoicesTable } from './invoices-table';

/**
 * Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md): the deferred
 * FEAT-046 screen closing the gap FEAT-046's own first slice left -- no
 * browser path existed to browse invoices at all, only to view one by id.
 * Status-filter tabs mirror issue #613's own `STAGE_TABS`/`searchParams`
 * pattern on `cases/page.tsx`; each row links to the existing
 * `/billing/invoices/[invoiceId]` detail page (FEAT-046).
 *
 * No page-level role gate here, deliberately diverging from the
 * proposal's own §2 (which named a `hasBillingRole` gate) once
 * `sidebar.tsx`'s own already-established real convention was read during
 * implementation: "no nav-level role gate exists anywhere in this file" —
 * every real list screen (Cases, QC violations, Reference ranges) is
 * unconditionally reachable, with `GET /v1/invoices`'s own `CapabilityGuard`
 * as the sole real enforcement point, matching every other route on
 * `BillingController`. `hasBillingRole` (`apps/web/auth/roles.ts`) is still
 * added, ready for the §17.5/17.6 follow-ups that will have real actions
 * (reminder sending, refund approval) worth gating client-side — this page
 * has no such action to gate.
 */
const STATUS_TABS = [
  { key: undefined, label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid', label: 'Paid' },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const normalizedStatus = status ? (status as 'unpaid' | 'partial' | 'paid') : undefined;

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    // Issue #758: a thrown Error's message is redacted by Next.js in a real production
    // build (see `frontend-design` Skill entry #12) -- return inline instead.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  // Issue #765: the tenant's own currency setting, not a hardcoded USD --
  // GET /v1/org-settings is gated only by AnyRoleGuard (any authenticated
  // role), so this never adds a new permission requirement to this page.
  const { data: orgSettings } = await client.GET('/v1/org-settings');

  const { data, response } = await client.GET('/v1/invoices', {
    params: { query: { status: normalizedStatus } },
  });
  // Issue #751: a thrown Error's message is redacted by Next.js in a real
  // production build (confirmed live via CI, not assumed) -- return early
  // instead, matching admin/users/page.tsx's own proven pattern. This was
  // this codebase's own original "reference implementation" for the
  // throw+error.tsx shape (see billing/invoices/error.tsx's own header
  // comment) -- confirmed broken in production by this same task.
  if (response.status === 403) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
        </div>
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view invoices.
        </p>
      </div>
    );
  }
  if (!response.ok || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading invoices. Please try again.
        </p>
      </div>
    );
  }

  function filterHref(tabStatus: string | undefined): string {
    return tabStatus ? `/billing/invoices?status=${tabStatus}` : '/billing/invoices';
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
        <p className="mt-1 text-sm text-text-secondary">{data.items.length} invoice(s).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Invoice status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.label}
            asChild
            variant={normalizedStatus === tab.key ? 'default' : 'outline'}
            size="sm"
          >
            <Link
              href={filterHref(tab.key)}
              role="tab"
              aria-selected={normalizedStatus === tab.key}
            >
              {tab.label}
            </Link>
          </Button>
        ))}
      </div>
      <InvoicesTable rows={data.items} currency={orgSettings?.currency ?? null} />
    </div>
  );
}
