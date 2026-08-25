import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { StatCard } from '@lis/ui';
import { TrendChart } from '../../../../../(portal)/portal/results/trend-chart';

/**
 * FEAT-038: the clinician-facing twin of `(portal)/portal/results/page.tsx`
 * -- same `TrendChart`, one real difference: `GET /v1/clinician/patients/
 * :patientId/results` bypasses the patient-portal release-policy delay
 * entirely (proposal §10 Q2) and is scoped to the caller's own related
 * patients rather than a self-lookup.
 */
export default async function ClinicianPatientResultsPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: patient, response: patientResponse },
    { data, response },
  ] = await Promise.all([
    client.GET('/v1/patients/{id}', { params: { path: { id: patientId } } }),
    client.GET('/v1/clinician/patients/{patientId}/results', {
      params: { path: { patientId } },
    }),
  ]);

  if (patientResponse.status === 404 || response.status === 404) {
    notFound();
  }
  if (!patientResponse.ok || !patient) {
    throw new Error('Something went wrong loading this patient. Please try again.');
  }
  // Issue #751: a thrown Error's message is redacted by Next.js in a real
  // production build (confirmed live via CI, not assumed) -- return early
  // instead, matching admin/users/page.tsx's own proven pattern.
  if (response.status === 403) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-foreground">
          {patient.firstName} {patient.lastName}
        </h1>
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view this patient’s results.
        </p>
      </div>
    );
  }
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading results. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="text-sm text-text-secondary">
            MRN <span className="font-mono">{patient.mrn}</span>
          </p>
        </div>
        <Link
          href={`/clinician/orders/new?patientId=${patientId}`}
          className="text-sm text-primary underline"
        >
          Place an order
        </Link>
      </div>

      {data.analytes.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface text-center">
          <p className="text-sm text-text-secondary">No results are available yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.analytes.map((a) => (
              <StatCard
                key={a.analyteId}
                label={a.analyteDisplay}
                value={`${a.latest.value} ${a.latest.unit}`}
              />
            ))}
          </div>
          <div className="flex flex-col gap-8">
            {data.analytes.map((a) => (
              <section key={a.analyteId} className="flex flex-col gap-2">
                <h2 className="text-base font-semibold text-foreground">{a.analyteDisplay}</h2>
                <TrendChart analyteDisplay={a.analyteDisplay} points={a.trend} />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
