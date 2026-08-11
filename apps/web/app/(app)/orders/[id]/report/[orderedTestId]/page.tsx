import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasVerifierRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';

/**
 * TASK-060 (FEAT-016 revision §1 finding #1/#5). No new backend read route --
 * PRELIMINARY vs. FINAL is computed entirely from the already-existing
 * `GET /v1/ordered-tests/:id/results` (TASK-051/052/057) against the
 * catalog's own per-test analyte count: FINAL once every analyte the test
 * definition names has a `'verified'` observation, PRELIMINARY otherwise --
 * exactly the same set `assembleAndPersistReport` (TASK-059) itself checks,
 * so this page's own FINAL reading and the backend's willingness to
 * generate a real PDF can never disagree.
 *
 * One ordered test (one panel) per page, not the whole order -- matching
 * TASK-059's own per-`ordered_test` report scope (KB-02: "chemistry = per
 * panel"), not `/orders/[id]/results`'s order-wide grid.
 */
export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string; orderedTestId: string }>;
}) {
  const { id, orderedTestId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);
  const session = await getSession();
  const isVerifier = hasVerifierRole(session);

  const [
    { data: order, response: orderResponse },
    { data: catalog, response: catalogResponse },
  ] = await Promise.all([
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

  const orderedTest = order.orderedTests.find((t) => t.id === orderedTestId);
  if (!orderedTest) {
    notFound();
  }
  const test = catalog.tests.find((t) => t.id === orderedTest.testDefinitionId);
  if (!test) {
    throw new Error('Something went wrong loading this test definition. Please try again.');
  }

  const { data: results, response: resultsResponse } = await client.GET(
    '/v1/ordered-tests/{id}/results',
    { params: { path: { id: orderedTestId } } },
  );
  if (!resultsResponse.ok || !results) {
    throw new Error('Something went wrong loading this panel\'s results. Please try again.');
  }

  const totalAnalytes = test.analytes.length;
  const verifiedCount = results.filter((r) => r.status === 'verified').length;
  const isFinal = totalAnalytes > 0 && verifiedCount === totalAnalytes;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>
              {order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : 'Report'}
            </CardTitle>
            <p className="mt-1 text-sm text-text-secondary">{test.displayName}</p>
          </div>
          {/* The literal AC: unambiguous PRELIMINARY vs. FINAL, driven by
              real data (verifiedCount/totalAnalytes), not a second render
              path (revision finding #1). */}
          <Badge
            variant={isFinal ? 'default' : 'outline'}
            aria-label={isFinal ? 'Final report' : 'Preliminary report'}
          >
            {isFinal ? 'FINAL' : 'PRELIMINARY'}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {verifiedCount} of {totalAnalytes} result{totalAnalytes === 1 ? '' : 's'} verified
          </p>
          {isFinal ? (
            isVerifier ? (
              // Plain <a>, not next/link -- forces a full navigation so the
              // Route Handler's own Content-Disposition response actually
              // triggers a browser "Save As", matching TASK-046's own
              // identical "Print label" precedent and its own documented
              // reason (engineering/frontend-design entry #5: client-side
              // nav leaves a prior route's RSC payload behind in the DOM).
              <Button asChild>
                <a href={`/orders/${id}/report/${orderedTestId}/download`}>Download PDF</a>
              </Button>
            ) : (
              <p className="text-sm text-text-secondary">
                This report is ready. Downloading requires a verifier-roled session.
              </p>
            )
          ) : results.length > 0 ? (
            // FEAT-054 (ADR-0047): at least one result recorded -- the same
            // relaxed precondition `assembleAndPersistPreliminaryReport`
            // itself checks, so this button's own visibility and the
            // backend's willingness to generate a real PDF can never
            // disagree (same discipline this page's own FINAL/isFinal
            // check already established, TASK-060's own header comment).
            isVerifier ? (
              <Button asChild variant="outline">
                <a href={`/orders/${id}/report/${orderedTestId}/download/preliminary`}>
                  Download preliminary PDF
                </a>
              </Button>
            ) : (
              <p className="text-sm text-text-secondary">
                A preliminary report is available. Downloading requires a verifier-roled session.
              </p>
            )
          ) : (
            <p className="text-sm text-text-secondary">
              This report will be available once at least one result on this panel is recorded.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
