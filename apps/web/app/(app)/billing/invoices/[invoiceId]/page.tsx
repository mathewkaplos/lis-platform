import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { InvoiceView } from './invoice-view';

/**
 * FEAT-046 (ADR-0041, approved proposal §5): Invoice Details (§17.2) +
 * Payment Screen (§17.3) + Receipt (§17.4), all on this one route -- see
 * `invoice-view.tsx`'s own header comment for why.
 *
 * A cross-tenant or nonexistent id surfaces the API's real 404 via
 * `notFound()`, matching `orders/[id]/page.tsx`'s own convention
 * (`engineering/api-design` entry #7).
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: invoice, response } = await client.GET('/v1/invoices/{id}', {
    params: { path: { id: invoiceId } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !invoice) {
    throw new Error('Something went wrong loading this invoice. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <InvoiceView invoice={invoice} />
    </div>
  );
}
