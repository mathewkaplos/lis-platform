import Link from 'next/link';
import { Button } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { STATUS_TABS } from './case-status';
import { CasesTable } from './cases-table';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). A plain list, mirroring
 * `patients`/`orders` list pages' own shape -- the minimal case UI this
 * proposal's own §1 scoped, just enough to reach the WSI viewer, not a
 * broader AP screen build-out (no synoptic-result display, no sign-out UI).
 *
 * Status tabs added for issue #613 -- `searchParams`-driven, same pattern as
 * `apps/web/app/(app)/page.tsx`'s own `STAGE_TABS`/`filterHref`.
 */
export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const normalizedStatus = status
    ? (status as 'accessioned' | 'in_process' | 'pending_review' | 'signed_out' | 'amended')
    : undefined;

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.GET('/v1/cases', {
    params: { query: { status: normalizedStatus } },
  });
  if (response.status === 403) {
    throw new Error('You do not have permission to view cases.');
  }
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading cases. Please try again.');
  }

  function filterHref(tabStatus: string | undefined): string {
    return tabStatus ? `/cases?status=${tabStatus}` : '/cases';
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cases</h1>
        <p className="mt-1 text-sm text-text-secondary">{data.items.length} case(s).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Case status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.label}
            asChild
            variant={normalizedStatus === tab.key ? 'default' : 'outline'}
            size="sm"
          >
            <Link
              href={filterHref(tab.key)}
              role="tab"
              aria-selected={normalizedStatus === tab.key}
            >
              {tab.label}
            </Link>
          </Button>
        ))}
      </div>
      <CasesTable rows={data.items} />
    </div>
  );
}
