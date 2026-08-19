import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
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

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
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
    throw new Error('Something went wrong loading this order. Please try again.');
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
