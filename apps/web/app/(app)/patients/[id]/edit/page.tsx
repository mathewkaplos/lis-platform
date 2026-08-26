import { notFound } from 'next/navigation';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { EditPatientForm } from './edit-patient-form';

/**
 * Issue #747 (docs/plans/task-747-patient-demographic-editing.md): the
 * correction path for a mistyped registration. Fetches the current row
 * server-side (same 404 handling as `patients/[id]/page.tsx`) so the client
 * form starts pre-filled with real values, not blank.
 */
export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const { data: patient, response } = await client.GET('/v1/patients/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !patient) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading this patient. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <EditPatientForm
        patientId={id}
        initialValues={{
          firstName: patient.firstName,
          middleName: patient.middleName ?? '',
          lastName: patient.lastName,
          sex: patient.sex,
          birthDate: patient.birthDate ?? '',
          nationalId: patient.nationalId ?? '',
          phone: patient.phone ?? '',
          email: patient.email ?? '',
          address: patient.address ?? '',
          nextOfKinName: patient.nextOfKinName ?? '',
          nextOfKinPhone: patient.nextOfKinPhone ?? '',
        }}
      />
    </div>
  );
}
