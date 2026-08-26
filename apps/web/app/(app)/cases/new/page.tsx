import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasSpecimenManagementRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';
import { CaseAccessionForm } from './case-accession-form';

/**
 * Issue #633. Entry point is exclusively from an order's own detail page
 * ("New AP case" link, `orders/[id]/page.tsx`) -- `orderId` is a required
 * query param, not a standalone order-searchable screen, matching
 * `orders/new/page.tsx`'s own identical convention (order search/creation
 * already has its own working UI; duplicating that lookup here would be a
 * second, parallel implementation of the same thing). A missing `orderId`
 * is a real error state, never a silent redirect/guess.
 */
export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  if (!orderId) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <p role="alert" className="text-sm text-danger">
          Select an order first — start from{' '}
          <Link href="/orders" className="underline">
            orders
          </Link>
          .
        </p>
      </div>
    );
  }

  const [accessToken, session] = await Promise.all([getValidAccessToken(), getSession()]);
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
  // Issue #665: matches synoptic/[partId]/page.tsx's own page-level gate --
  // a user reaching this page directly by URL without manage_specimens
  // should be blocked here, not just have the order-detail page's own
  // entry link hidden.
  // Issue #751: a thrown Error's message is redacted by Next.js in a real
  // production build (confirmed live via CI, not assumed) -- return early
  // instead, matching admin/users/page.tsx's own proven pattern.
  if (!hasSpecimenManagementRole(session)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to accession a new case.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const { data: order, response } = await client.GET('/v1/orders/{id}', {
    params: { path: { id: orderId } },
  });
  // RLS makes a cross-tenant order id structurally invisible, same as
  // patients/[id]/page.tsx's own convention (engineering/api-design #7).
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !order) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading this order. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">New AP case</h1>
        <p className="text-sm text-text-secondary">
          {order.patient ? (
            <>
              For {order.patient.firstName} {order.patient.lastName} — MRN{' '}
              <span className="font-mono">{order.patient.mrn}</span>
            </>
          ) : (
            'For this order'
          )}
        </p>
      </div>
      <CaseAccessionForm orderId={orderId} />
    </div>
  );
}
