import { getTranslations } from 'next-intl/server';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { ORDER_SEARCH_RESULT_LIMIT } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { OrdersTable } from './orders-table';

/**
 * TASK-044 (FEAT-012 proposal §5). A global, cross-patient order list --
 * Stitch §6.2's own standalone screen, not nested under a patient's
 * profile (matching real lab-operations value, e.g. "every STAT order
 * today"). Plain GET form, same `patients/page.tsx` pattern -- filters
 * live in the URL's `searchParams`, a Server Component throughout.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    createdFrom?: string;
    createdTo?: string;
  }>;
}) {
  const { status, priority, createdFrom, createdTo } = await searchParams;
  const t = await getTranslations('Orders');
  // The filter form's <select>/<input type="date"> submit an empty string
  // when left at "Any"/blank, not an absent key -- the API's Zod schema
  // rejects an empty string for an enum/datetime field with a real 400
  // (found live: `status=&priority=stat&...` 400'd instead of just
  // filtering on priority). Normalize every filter to undefined when empty,
  // not just createdFrom/createdTo.
  const normalizedStatus = status ? (status as 'ordered' | 'cancelled') : undefined;
  const normalizedPriority = priority ? (priority as 'routine' | 'stat') : undefined;

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

  const [{ data: orders, response: ordersResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/orders', {
        params: {
          query: {
            status: normalizedStatus,
            priority: normalizedPriority,
            createdFrom: createdFrom ? `${createdFrom}T00:00:00.000Z` : undefined,
            createdTo: createdTo ? `${createdTo}T23:59:59.999Z` : undefined,
          },
        },
      }),
      client.GET('/v1/catalog'),
    ]);
  if (!ordersResponse.ok || !orders) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading orders. Please try again.
        </p>
      </div>
    );
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

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" action="/orders">
            <label className="flex flex-col gap-1 text-sm">
              {t('status')}
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{t('any')}</option>
                <option value="ordered">{t('ordered')}</option>
                <option value="cancelled">{t('cancelled')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('priority')}
              <select
                name="priority"
                defaultValue={priority ?? ''}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{t('any')}</option>
                <option value="routine">{t('routine')}</option>
                <option value="stat">{t('stat')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('from')}
              <input
                type="date"
                name="createdFrom"
                defaultValue={createdFrom}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('to')}
              <input
                type="date"
                name="createdTo"
                defaultValue={createdTo}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <Button type="submit">{t('apply')}</Button>
          </form>
        </CardContent>
      </Card>

      <OrdersTable rows={orders} testNameById={testNameById} />
      {orders.length === ORDER_SEARCH_RESULT_LIMIT ? (
        <p className="text-xs text-text-secondary">
          {t('showingFirst', { limit: ORDER_SEARCH_RESULT_LIMIT })}
        </p>
      ) : null}
    </div>
  );
}
