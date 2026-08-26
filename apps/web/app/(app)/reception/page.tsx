import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ReceptionForm } from './reception-form';

/**
 * TASK-047 (FEAT-013 revision §10 Q1, human-approved 2026-08-05). The
 * lookup field accepts a scanned/pasted/typed Order id directly (a
 * keyboard-wedge scanner emits keystrokes identically to typing, so no
 * scanner-specific code is needed either way) — this is a plain GET form,
 * no client JS required for the lookup step itself. When the value doesn't
 * resolve to a real order, this falls back to pointing at the existing
 * `/orders` search (already built, TASK-042/044) rather than duplicating
 * that lookup UI here. The order detail page (`orders/[id]/page.tsx`) also
 * links here directly (`?orderId=`) as the no-scanner path, for a receiving
 * user who found the order via search first.
 */
export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;

  if (!orderId) {
    return <LookupForm />;
  }

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

  const [{ data: order, response: orderResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/orders/{id}', { params: { path: { id: orderId } } }),
      client.GET('/v1/catalog'),
    ]);

  // A malformed or nonexistent order id is a real, expected input here
  // (this is a lookup-by-hand entry point, not a per-order detail page) --
  // shown as a friendly retry, not a hard 404 (contrast
  // orders/[id]/page.tsx's own notFound() convention, which is for a link
  // already known to be valid).
  if (!orderResponse.ok || !order) {
    return <LookupForm notFoundId={orderId} />;
  }
  if (!catalogResponse.ok || !catalog) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading the test catalog. Please try again.
        </p>
      </div>
    );
  }

  const testNameById = new Map(catalog.tests.map((t) => [t.id, t.displayName]));
  const eligibleOrderedTests = order.orderedTests
    .filter((t) => t.status === 'ordered')
    .map((t) => ({
      id: t.id,
      testDefinitionId: t.testDefinitionId,
      displayName: testNameById.get(t.testDefinitionId) ?? t.testDefinitionId,
    }));

  if (eligibleOrderedTests.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>Nothing to receive</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary">
              Every test on this order has already been received, rejected, or cancelled.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href={`/orders/${orderId}`}>View order</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ReceptionForm
        order={{ id: order.id, patient: order.patient, eligibleOrderedTests }}
      />
    </div>
  );
}

function LookupForm({ notFoundId }: { notFoundId?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Reception</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notFoundId ? (
            <p role="alert" className="text-sm text-danger">
              No order found for &ldquo;{notFoundId}&rdquo;. Scan or paste an order id, or search
              below.
            </p>
          ) : (
            <p className="text-sm text-text-secondary">
              Scan or paste the order id to receive its specimen.
            </p>
          )}
          <form action="/reception" className="flex gap-2">
            <Input
              name="orderId"
              placeholder="Order id"
              aria-label="Order id"
              defaultValue={notFoundId}
              required
            />
            <Button type="submit">Look up</Button>
          </form>
          <p className="text-sm text-text-secondary">
            Don&apos;t have the order id?{' '}
            <Link href="/orders" className="underline">
              Search orders
            </Link>{' '}
            and open the order&apos;s detail page instead.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
