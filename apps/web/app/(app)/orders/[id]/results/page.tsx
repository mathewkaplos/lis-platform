import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasPathologistRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';
import { ResultsGrid, type PriorResult, type ResultRow } from './results-grid';

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
  // TASK-057 (FEAT-015 revision §2/§10 Q3): this repo's first frontend
  // role-visibility decision -- read once, server-side, and pass down as a
  // plain boolean prop rather than the whole session (`hasPathologistRole` is
  // the only thing the grid needs to know about the caller).
  const session = await getSession();
  const isVerifier = hasPathologistRole(session);

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
  // TASK-055/057: `status` widened to include 'verified', and the row now
  // also carries `verifierUserId`/`verifiedAt` (domain schema widening,
  // proposal §2/§10 Q4) -- `list()` returns every current observation for an
  // ordered test regardless of status, and an analyte can now genuinely be
  // 'verified' by the time this page loads.
  const resultsByOrderedTestId = new Map<
    string,
    {
      analyteId: string;
      valueNum: number | null;
      // FEAT-024 (ADR-0025): present on the real list() response for any
      // dataType, simply always null for a quantity row.
      valueCode: string | null;
      // Issue #694: present on the real list() response for any dataType,
      // null unless this row is `coded`/`table` and its own value actually
      // resolved (`@lis/domain`'s `observationSchema.valueDisplay`).
      valueDisplay: string | null;
      notes: string | null;
      flags: string[];
      refLow: number | null;
      refHigh: number | null;
      status: 'registered' | 'preliminary' | 'verified';
      source: string;
      verifierUserId: string | null;
      verifiedAt: string | null;
    }[]
  >();
  fetchableTests.forEach((t, i) => {
    resultsByOrderedTestId.set(t.id, resultsResponses[i].data ?? []);
  });

  const rowsWithoutPrior: Omit<ResultRow, 'priorResults'>[] = [];
  for (const orderedTest of order.orderedTests) {
    const test = testById.get(orderedTest.testDefinitionId);
    if (!test) continue;
    for (const analyte of test.analytes) {
      // Quantity + ordinal UI (FEAT-024/ADR-0025), widened to coded/table by
      // issue #694 -- `text` still has no real catalog/rendering behind it
      // and stays filtered out. coded/table render read-only in the grid
      // (`results-grid.tsx`'s own `isEnterable`/result-cell branch), never
      // an editable control.
      if (
        analyte.dataType !== 'quantity' &&
        analyte.dataType !== 'ordinal' &&
        analyte.dataType !== 'coded' &&
        analyte.dataType !== 'table'
      )
        continue;
      const existing = resultsByOrderedTestId.get(orderedTest.id)?.find((o) => o.analyteId === analyte.id);
      rowsWithoutPrior.push({
        orderedTestId: orderedTest.id,
        orderedTestStatus: orderedTest.status,
        testDisplayName: test.displayName,
        analyteId: analyte.id,
        analyteCode: analyte.code,
        analyteDisplay: analyte.display,
        dataType: analyte.dataType,
        unit: analyte.unit,
        initialValueNum: existing?.valueNum ?? null,
        initialValueCode: existing?.valueCode ?? null,
        initialValueDisplay: existing?.valueDisplay ?? null,
        initialNotes: existing?.notes ?? null,
        initialFlags: existing?.flags ?? [],
        initialRefLow: existing?.refLow ?? null,
        initialRefHigh: existing?.refHigh ?? null,
        initialObservationStatus: existing?.status ?? null,
        initialVerifierUserId: existing?.verifierUserId ?? null,
        initialVerifiedAt: existing?.verifiedAt ?? null,
      });
    }
  }

  // TASK-057 (FEAT-015 revision §2/§10 Q1): one small GET per row, bounded by
  // a real panel's real size (same "not paginated" reasoning already used
  // above for the per-ordered-test results fetch) -- the patient's own prior
  // result for this analyte, no delta computed.
  const priorResponses = await Promise.all(
    rowsWithoutPrior.map((row) =>
      client.GET('/v1/ordered-tests/{id}/results/{analyteId}/prior', {
        params: { path: { id: row.orderedTestId, analyteId: row.analyteId } },
      }),
    ),
  );
  const rows: ResultRow[] = rowsWithoutPrior.map((row, i) => ({
    ...row,
    priorResults: (priorResponses[i].data ?? []) as PriorResult[],
  }));

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
      <ResultsGrid rows={rows} isVerifier={isVerifier} />
    </div>
  );
}
