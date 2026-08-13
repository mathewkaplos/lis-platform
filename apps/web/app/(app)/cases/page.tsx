import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CasesTable } from './cases-table';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). A plain list, mirroring
 * `patients`/`orders` list pages' own shape -- the minimal case UI this
 * proposal's own §1 scoped, just enough to reach the WSI viewer, not a
 * broader AP screen build-out (no synoptic-result display, no sign-out UI).
 */
export default async function CasesPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.GET('/v1/cases');
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading cases. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cases</h1>
        <p className="mt-1 text-sm text-text-secondary">{data.items.length} case(s).</p>
      </div>
      <CasesTable rows={data.items} />
    </div>
  );
}
