import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ResultsGrid, type ResultRow } from './results-grid';

const ENTERABLE_OR_DONE = new Set(['received', 'in_process', 'resulted']);

/**
 * TASK-052 (FEAT-014 revision §2). One row per (orderedTest, analyte) pair
 * -- the real `observation` write granularity (KB-14: "one Observation per
 * analyte"), not per order. `GET /v1/ordered-tests/:id/results` is fetched
 * per ordered test needing entry, in one `Promise.all` -- bounded by a real
 * panel's real size (up to 14 for the seeded CMP), not paginated, same
 * "don't build ahead of a real need" call as `ORDER_SEARCH_RESULT_LIMIT`
 * (proposal §2). `ordered` (not yet received) tests are still rendered,
 * disabled, so the full panel's shape stays visible (proposal §5).
 */
export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [{ data: order, response: orderResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/orders/{id}', { params: { path: { id } } }),
      client.GET('/v1/catalog'),
    ]);
  if (orderResponse.status === 404) {
    notFound();
  }
  if (!orderResponse.ok || !order) {
    throw new Error('Something went wrong loading this order. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }

  const testById = new Map(catalog.tests.map((t) => [t.id, t]));

  const fetchableTests = order.orderedTests.filter((t) => ENTERABLE_OR_DONE.has(t.status));
  const resultsResponses = await Promise.all(
    fetchableTests.map((t) => client.GET('/v1/ordered-tests/{id}/results', { params: { path: { id: t.id } } })),
  );
  const resultsByOrderedTestId = new Map<
    string,
    {
      analyteId: string;
      valueNum: number | null;
      flags: string[];
      refLow: number | null;
      refHigh: number | null;
      status: 'registered' | 'preliminary';
      source: string;
    }[]
  >();
  fetchableTests.forEach((t, i) => {
    resultsByOrderedTestId.set(t.id, resultsResponses[i].data ?? []);
  });

  const rows: ResultRow[] = [];
  for (const orderedTest of order.orderedTests) {
    const test = testById.get(orderedTest.testDefinitionId);
    if (!test) continue;
    for (const analyte of test.analytes) {
      // Quantity-only UI this task (proposal §5) -- no real coded/text
      // analyte exists in the seeded catalog to render either shape against.
      if (analyte.dataType !== 'quantity') continue;
      const existing = resultsByOrderedTestId.get(orderedTest.id)?.find((o) => o.analyteId === analyte.id);
      rows.push({
        orderedTestId: orderedTest.id,
        orderedTestStatus: orderedTest.status,
        testDisplayName: test.displayName,
        analyteId: analyte.id,
        analyteCode: analyte.code,
        analyteDisplay: analyte.display,
        unit: analyte.unit,
        initialValueNum: existing?.valueNum ?? null,
        initialFlags: existing?.flags ?? [],
        initialRefLow: existing?.refLow ?? null,
        initialRefHigh: existing?.refHigh ?? null,
        initialObservationStatus: existing?.status ?? null,
      });
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Enter results</h1>
        {order.patient ? (
          <p className="mt-1 text-sm text-text-secondary">
            {order.patient.firstName} {order.patient.lastName} · MRN{' '}
            <span className="font-mono text-foreground">{order.patient.mrn}</span>
          </p>
        ) : null}
      </div>
      <ResultsGrid rows={rows} />
    </div>
  );
}
