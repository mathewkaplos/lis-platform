import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { LeveyJenningsChart } from './levey-jennings-chart';

/**
 * TASK-069 (FEAT-019, Stitch §14.4). Consumes TASK-068's
 * `GET /v1/control-lots/:id/chart` directly -- no control-lot list/QC
 * dashboard exists yet to link here from (no task in this proposal's scope
 * builds one), so this route is reachable by direct link only for now,
 * same "nav grows as later features add routes" discipline
 * `_components/sidebar.tsx` already states for its own NAV_ITEMS.
 *
 * A cross-tenant or nonexistent id surfaces the API's real 404 via
 * `notFound()` (`engineering/api-design` entry #7), matching
 * `orders/[id]/page.tsx`'s own convention. A non-quantity-dataType control
 * lot's real 400 (TASK-068's own scope boundary) is treated as a genuine
 * error, not a silent empty page -- surfaced via the thrown-Error path
 * `error.tsx` catches, same as every other unexpected-response case on this
 * page.
 */
export default async function ControlLotChartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [{ data: chart, response: chartResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/control-lots/{id}/chart', { params: { path: { id } } }),
      client.GET('/v1/catalog'),
    ]);
  if (chartResponse.status === 404) {
    notFound();
  }
  if (!chartResponse.ok || !chart) {
    throw new Error('Something went wrong loading this control lot’s chart. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }

  const analyte = catalog.tests.flatMap((t) => t.analytes).find((a) => a.id === chart.analyteId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {analyte ? analyte.display : 'Control lot'} — Levey-Jennings chart
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Level: <span className="font-medium text-foreground">{chart.level}</span> · Target:{' '}
          <span className="font-mono text-foreground">
            {chart.targetMean} ± {chart.targetSd}
          </span>
          {analyte?.unit ? ` ${analyte.unit}` : ''}
        </p>
      </div>
      <LeveyJenningsChart targetMean={chart.targetMean} targetSd={chart.targetSd} points={chart.points} />
    </div>
  );
}
