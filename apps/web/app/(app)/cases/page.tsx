import Link from 'next/link';
import { Button } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CasesTable } from './cases-table';

// issue #613 (BUG-CYTO-01): `GET /v1/cases` excludes `signed_out`/`amended`
// cases by default, and accepts a single `status` value to see any one
// status -- no "all" sentinel. `key: undefined` reproduces today's default
// (omit `status` entirely, not an empty string -- an empty string 400s the
// same way `orders/page.tsx`'s own documented gotcha describes).
const STATUS_TABS = [
  { key: undefined, label: 'Active' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'signed_out', label: 'Signed Out' },
  { key: 'amended', label: 'Amended' },
] as const;

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
          <Link key={tab.label} href={filterHref(tab.key)}>
            <Button
              type="button"
              variant={normalizedStatus === tab.key ? 'default' : 'outline'}
              size="sm"
              role="tab"
              aria-selected={normalizedStatus === tab.key}
            >
              {tab.label}
            </Button>
          </Link>
        ))}
      </div>
      <CasesTable rows={data.items} />
    </div>
  );
}
