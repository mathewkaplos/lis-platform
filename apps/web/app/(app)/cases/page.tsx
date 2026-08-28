import Link from 'next/link';
import { Button, Input } from '@lis/ui';
import { CASE_LIST_RESULT_LIMIT } from '@lis/domain';
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
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const normalizedStatus = status
    ? (status as 'accessioned' | 'in_process' | 'pending_review' | 'signed_out' | 'amended')
    : undefined;
  const trimmedQ = q?.trim() || undefined;

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

  const { data, response } = await client.GET('/v1/cases', {
    params: { query: { status: normalizedStatus, q: trimmedQ } },
  });
  if (response.status === 403) {
    // Issue #750 cleanup, same fix issue #758 already applied to 88 other
    // instances of this exact redacted-in-production shape (`frontend-design`
    // Skill entry #12) -- found live while touching this file for the
    // patient-name/search change, not a separate unrelated pass.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view cases.
        </p>
      </div>
    );
  }
  if (!response.ok || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading cases. Please try again.
        </p>
      </div>
    );
  }

  function filterHref(tabStatus: string | undefined): string {
    const params = new URLSearchParams();
    if (tabStatus) params.set('status', tabStatus);
    if (trimmedQ) params.set('q', trimmedQ);
    const qs = params.toString();
    return qs ? `/cases?${qs}` : '/cases';
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cases</h1>
        <p className="mt-1 text-sm text-text-secondary">{data.items.length} case(s).</p>
        {/* Issue #749 (EPIC #697): plain GET form, same pattern
            patients/page.tsx and orders/page.tsx already use -- `q` lives in
            the URL's searchParams, keeping this a Server Component. Combines
            with the status tabs below (both submit to the same route). */}
        <form className="mt-2 flex max-w-sm gap-2" action="/cases">
          {normalizedStatus ? (
            <input type="hidden" name="status" value={normalizedStatus} />
          ) : null}
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by patient name or MRN"
            aria-label="Search cases"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {/* Issue #707 (EPIC #697): AP case creation is deliberately reachable
            only from an order's own detail page (cases/new/page.tsx's own
            header comment) -- nothing pointed a first-time user there.
            Confirmed via the pilot-readiness audit as a real discoverability
            gap, not a missing capability. */}
        <p className="mt-1 text-sm text-text-secondary">
          New cases start from an order:{' '}
          <Link href="/orders" className="underline">
            open an order
          </Link>{' '}
          and use its own &quot;New AP case&quot; action.
        </p>
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
      {data.items.length === CASE_LIST_RESULT_LIMIT ? (
        <p className="text-xs text-text-secondary">
          Showing the first {CASE_LIST_RESULT_LIMIT} cases. Narrow your search for more
          specific results.
        </p>
      ) : null}
    </div>
  );
}
