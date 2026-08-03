import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createPatientApiClient } from '@/lib/api-client';
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

  let results: PatientRow[] | null = null;
  if (trimmedQ) {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error('Your session has expired — please log in again.');
    }
    const client = createPatientApiClient(accessToken);
    const { data, response } = await client.GET('/v1/patients', {
      params: { query: { q: trimmedQ } },
    });
    if (!response.ok) {
      throw new Error('Something went wrong searching for patients. Please try again.');
    }
    results = (data ?? []) as PatientRow[];
  }

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

      {results === null ? (
        <p className="text-sm text-text-secondary">
          Search by name, MRN, or national ID to find a patient.
        </p>
      ) : (
        <>
          <PatientsTable rows={results} />
          {results.length === PATIENT_SEARCH_RESULT_LIMIT ? (
            <p className="text-xs text-text-secondary">
              Showing the first {PATIENT_SEARCH_RESULT_LIMIT} matches. Refine your search for
              more specific results.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
