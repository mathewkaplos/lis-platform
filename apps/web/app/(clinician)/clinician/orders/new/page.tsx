import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { OrderBuilderForm } from '../../../../(app)/orders/new/order-builder-form';
import { createClinicianOrder } from './actions';

/**
 * FEAT-038: the clinician-facing twin of `(app)/orders/new/page.tsx`.
 * `GET /v1/patients/:id` is already own-patient-scoped for a clinician
 * caller (FEAT-040) -- a 404 here is either a genuinely unknown patient or
 * one this clinician has no care_relationship to, indistinguishable by
 * design (`engineering/authz` entry #4).
 */
export default async function ClinicianNewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const { patientId } = await searchParams;
  if (!patientId) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <p role="alert" className="text-sm text-danger">
          Select a patient first — start from your{' '}
          <Link href="/clinician" className="underline">
            dashboard
          </Link>
          .
        </p>
      </div>
    );
  }

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

  const [
    { data: patient, response: patientResponse },
    { data: catalog, response: catalogResponse },
  ] = await Promise.all([
    client.GET('/v1/patients/{id}', { params: { path: { id: patientId } } }),
    client.GET('/v1/catalog'),
  ]);

  if (patientResponse.status === 404) {
    notFound();
  }
  if (!patientResponse.ok || !patient) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading this patient. Please try again.
        </p>
      </div>
    );
  }
  if (!catalogResponse.ok || !catalog) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading the test catalog. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">New order</h1>
        <p className="text-sm text-text-secondary">
          For {patient.firstName} {patient.lastName} — MRN{' '}
          <span className="font-mono">{patient.mrn}</span>
        </p>
      </div>
      <OrderBuilderForm
        patientId={patientId}
        catalog={catalog}
        action={createClinicianOrder}
        backHref="/clinician"
        backLabel="Back to dashboard"
      />
    </div>
  );
}
