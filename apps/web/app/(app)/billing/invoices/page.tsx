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
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.GET('/v1/invoices', {
    params: { query: { status: normalizedStatus } },
  });
  if (response.status === 403) {
    throw new Error('You do not have permission to view invoices.');
  }
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading invoices. Please try again.');
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
          <Link key={tab.label} href={filterHref(tab.key)}>
            <Button
              type="button"
              variant={normalizedStatus === tab.key ? 'default' : 'outline'}
              size="sm"
              role="tab"
              aria-selected={normalizedStatus === tab.key}
            >
              {tab.label}
            </Button>
          </Link>
        ))}
      </div>
      <InvoicesTable rows={data.items} />
    </div>
  );
}
