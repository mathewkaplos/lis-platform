'use server';

import { patientUpdateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { EditPatientState, SubmittedValues } from './types';

/**
 * Issue #747 (docs/plans/task-747-patient-demographic-editing.md). Unlike
 * `patients/new/actions.ts`'s `rawFormValues` (an empty field there means
 * "not provided," matching `patientCreateSchema`'s plain-optional shape),
 * this edit form is always a full re-submission of every field the API
 * already has a value for — a field the user clears is a deliberate "clear
 * this," not "leave it alone" (`undefined` would mean the latter to
 * `patientUpdateSchema`'s own partial-update semantics, which this UI
 * doesn't otherwise rely on since it always sends every key). `null` for
 * every clearable field, matching the schema's own nullable shape.
 */
function rawFormValues(formData: FormData) {
  const emptyToNull = (value: FormDataEntryValue | null) => (value ? value : null);
  return {
    firstName: formData.get('firstName') || undefined,
    middleName: emptyToNull(formData.get('middleName')),
    lastName: formData.get('lastName') || undefined,
    sex: formData.get('sex') || undefined,
    birthDate: emptyToNull(formData.get('birthDate')),
    nationalId: emptyToNull(formData.get('nationalId')),
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    address: emptyToNull(formData.get('address')),
    nextOfKinName: emptyToNull(formData.get('nextOfKinName')),
    nextOfKinPhone: emptyToNull(formData.get('nextOfKinPhone')),
  };
}

function submittedValuesOf(formData: FormData): SubmittedValues {
  return {
    firstName: String(formData.get('firstName') ?? ''),
    middleName: String(formData.get('middleName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    sex: String(formData.get('sex') ?? ''),
    birthDate: String(formData.get('birthDate') ?? ''),
    nationalId: String(formData.get('nationalId') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
    address: String(formData.get('address') ?? ''),
    nextOfKinName: String(formData.get('nextOfKinName') ?? ''),
    nextOfKinPhone: String(formData.get('nextOfKinPhone') ?? ''),
  };
}

export async function updatePatient(
  _prevState: EditPatientState,
  formData: FormData,
): Promise<EditPatientState> {
  const submittedValues = submittedValuesOf(formData);
  const patientId = String(formData.get('patientId') ?? '');

  const parsed = patientUpdateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.flatten().fieldErrors,
      submittedValues,
    };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
      submittedValues,
    };
  }
  const client = createLisApiClient(accessToken);

  const { response } = await client.PUT('/v1/patients/{id}', {
    params: { path: { id: patientId } },
    body: parsed.data,
  });
  if (!response.ok) {
    if (response.status === 409) {
      return {
        status: 'error',
        formError: 'A patient with this national ID already exists.',
        submittedValues,
      };
    }
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to edit patients.',
        submittedValues,
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong saving these changes. Please try again.',
      submittedValues,
    };
  }

  return { status: 'saved', submittedValues };
}
