import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { PatientsTable, type PatientRow } from './patients-table';
import { PATIENT_SEARCH_RESULT_LIMIT } from '@lis/domain';

/**
 * TASK-041 (FEAT-011): the patient search screen. Free-text search only
 * (proposal §5/§10 Q1, resolved 2026-08-03) -- no `FilterBar` panel, since
 * gender/registered-date are the only attributes with real backing data and
 * a two-attribute filter panel was judged marginal value for this task's
 * sizing. Results capped at `PATIENT_SEARCH_RESULT_LIMIT`, no pager, per
 * ADR-0013's cursor-pagination deferral (§10 Q2, resolved).
 *
 * Issue #716 (EPIC #697): landing here with no search term used to show only
 * a bare prompt ("search to find a patient") -- confirmed as a real gap in
 * the pilot-readiness audit: a front-desk user who just registered several
 * patients had no way to see "who did I just register" without remembering
 * a search term. Now defaults to the API's own `recent=true` mode (most
 * recently registered first) instead, alongside the still-present search
 * box -- a default view, not a replacement for search.
 *
 * A plain GET form (no client JS) drives the search -- `q` lives in the URL
 * `searchParams`, so this stays a Server Component; `loading.tsx` covers the
 * loading state during navigation, `error.tsx` covers a failed API call.
 */
export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const trimmedQ = q?.trim();
  const isSearch = Boolean(trimmedQ);

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

  const { data, response } = await client.GET('/v1/patients', {
    params: { query: isSearch ? { q: trimmedQ } : { recent: 'true' } },
  });
  if (!response.ok) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading patients. Please try again.
        </p>
      </div>
    );
  }
  const results = (data ?? []) as PatientRow[];

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Patients</h1>
        <Button asChild>
          <Link href="/patients/new">
            <UserPlus className="size-4" />
            Register patient
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" action="/patients">
            <Input
              type="search"
              name="q"
              defaultValue={trimmedQ}
              placeholder="Search by name, MRN, or national ID"
              aria-label="Search patients"
              autoFocus
            />
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {isSearch ? (
        <>
          <PatientsTable rows={results} />
          {results.length === PATIENT_SEARCH_RESULT_LIMIT ? (
            <p className="text-xs text-text-secondary">
              Showing the first {PATIENT_SEARCH_RESULT_LIMIT} matches. Refine your search for
              more specific results.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="text-sm font-medium text-text-secondary">Recently registered</h2>
          <PatientsTable rows={results} />
        </>
      )}
    </div>
  );
}
