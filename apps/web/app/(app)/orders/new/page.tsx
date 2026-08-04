import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { OrderBuilderForm } from './order-builder-form';

/**
 * TASK-043 (FEAT-012 proposal §5). Entry point is exclusively from a
 * patient's profile page ("New order" link, `patients/[id]/page.tsx`) --
 * `patientId` is a required query param, not a standalone patient-searchable
 * screen (apps/web already has a complete patient search, TASK-041;
 * duplicating it here would be a second, parallel implementation of the same
 * lookup). A missing `patientId` is a real error state, never a silent
 * redirect/guess.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const { patientId } = await searchParams;
  if (!patientId) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <p role="alert" className="text-sm text-danger">
          Select a patient first — start from{' '}
          <Link href="/patients" className="underline">
            patient search
          </Link>
          .
        </p>
      </div>
    );
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: patient, response: patientResponse },
    { data: catalog, response: catalogResponse },
  ] = await Promise.all([
    client.GET('/v1/patients/{id}', { params: { path: { id: patientId } } }),
    client.GET('/v1/catalog'),
  ]);

  // RLS makes a cross-tenant patient id structurally invisible, same as
  // patients/[id]/page.tsx's own convention (engineering/api-design #7).
  if (patientResponse.status === 404) {
    notFound();
  }
  if (!patientResponse.ok || !patient) {
    throw new Error('Something went wrong loading this patient. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
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
      <OrderBuilderForm patientId={patientId} catalog={catalog} />
    </div>
  );
}
