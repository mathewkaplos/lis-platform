import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CollectionQueueTable } from './collection-queue-table';

/**
 * TASK-048 (FEAT-013 revision). No backend change (revision §2/§5) —
 * `GET /v1/orders?status=ordered` (the existing filter) plus `GET
 * /v1/catalog` (for test display names, `orders/page.tsx`'s own
 * `testNameById` pattern) already carry everything this screen needs.
 *
 * "Pending collection" has no order-level status of its own
 * (`order.status` only ever transitions `'ordered' -> 'cancelled'`,
 * revision §1 finding #2) -- the real predicate is per-`OrderedTest`: at
 * least one `orderedTest` row still `status: 'ordered'`. Filtered here,
 * server-side (this Server Component), not client-side in the table --
 * each order's own `orderedTests` array is also reduced to just the
 * pending ones before being handed to the table, so "Tests pending
 * collection" never shows an already-received test.
 *
 * Sort: STAT priority first, then oldest `createdAt` first within each
 * tier (revision §5) -- no AC or KB text specifies an ordering; this is
 * the natural "most urgent, longest-waiting first" default.
 */
export default async function CollectionQueuePage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [{ data: orders, response: ordersResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/orders', { params: { query: { status: 'ordered' } } }),
      client.GET('/v1/catalog'),
    ]);
  if (!ordersResponse.ok || !orders) {
    throw new Error('Something went wrong loading the collection queue. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }

  const testNameById = new Map(catalog.tests.map((t) => [t.id, t.displayName]));

  const pendingRows = orders
    .map((order) => ({
      ...order,
      orderedTests: order.orderedTests.filter((t) => t.status === 'ordered'),
    }))
    .filter((order) => order.orderedTests.length > 0)
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === 'stat' ? -1 : 1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-foreground">Collection queue</h1>
      <CollectionQueueTable rows={pendingRows} testNameById={testNameById} />
    </div>
  );
}
