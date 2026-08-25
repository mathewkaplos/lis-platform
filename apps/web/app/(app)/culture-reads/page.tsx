import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CultureReadsTable, type CultureReadRow } from './culture-reads-table';

/**
 * FEAT-052 (docs/plans/feat-052-culture-workflow-reflex-cascade.md,
 * ADR-0046). "Cultures due for reading" -- a live query over `culture_read`
 * rows already due (`GET /v1/culture-reads`), the same "worklist = a live
 * query over operational state" model KB-26 already establishes, not a new
 * list-maintenance mechanism. Deliberately minimal (proposal §2's own
 * scope): no filters, no full-culture-history view, no order/patient
 * lookup -- same "no dashboard" framing `qc-violations/page.tsx` already
 * established for its own comparable list+action screen.
 */
export default async function CultureReadsPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: cultureReads, response } = await client.GET('/v1/culture-reads');
  if (response.status === 403) {
    throw new Error('You do not have permission to view cultures due for reading.');
  }
  if (!response.ok || !cultureReads) {
    throw new Error('Something went wrong loading cultures due for reading. Please try again.');
  }

  const rows: CultureReadRow[] = cultureReads.map((row) => ({
    id: row.id,
    orderedTestId: row.orderedTestId,
    scheduledAt: row.scheduledAt,
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cultures due for reading</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Recording growth automatically creates the organism-identification panel on the same
          specimen (ADR-0046). Recording is always a human action — nothing here is recorded
          automatically.
        </p>
      </div>
      <CultureReadsTable initialRows={rows} />
    </div>
  );
}
