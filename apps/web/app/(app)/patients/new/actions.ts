'use server';

import { patientCreateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { RegisterPatientState, SubmittedValues } from './types';

function rawFormValues(formData: FormData) {
  return {
    firstName: formData.get('firstName') || undefined,
    middleName: formData.get('middleName') || undefined,
    lastName: formData.get('lastName') || undefined,
    sex: formData.get('sex') || undefined,
    birthDate: formData.get('birthDate') || undefined,
    nationalId: formData.get('nationalId') || undefined,
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
  };
}

/**
 * TASK-040 (FEAT-011). The registration form's single Server Action —
 * duplicate-check and create both happen here, sequentially (proposal §5),
 * not as two client-orchestrated round trips: `getValidAccessToken()` is
 * only usable from a Server Action/Route Handler context (ADR-0014 §3), and
 * keeping both calls in one place avoids needing to thread a token to the
 * client at all.
 *
 * Duplicate check: exact, case-insensitive match on
 * `firstName`+`lastName`+`birthDate` only (proposal §10 Q1) — a soft,
 * reviewable warning shown once; resubmitting with `confirmDuplicate=true`
 * (the hidden field the form sets after the user reviews and proceeds)
 * skips straight to create.
 */
export async function registerPatient(
  _prevState: RegisterPatientState,
  formData: FormData,
): Promise<RegisterPatientState> {
  const submittedValues = submittedValuesOf(formData);
  const parsed = patientCreateSchema.safeParse(rawFormValues(formData));
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

  const confirmedDuplicate = formData.get('confirmDuplicate') === 'true';
  if (!confirmedDuplicate && parsed.data.birthDate) {
    const { data: matches } = await client.GET('/v1/patients', {
      params: {
        query: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          birthDate: parsed.data.birthDate,
        },
      },
    });
    if (matches && matches.length > 0) {
      const match = matches[0];
      return {
        status: 'duplicate-found',
        duplicateMatch: {
          id: match.id,
          mrn: match.mrn,
          firstName: match.firstName,
          lastName: match.lastName,
          birthDate: match.birthDate,
        },
        submittedValues,
      };
    }
  }

  const { data, response } = await client.POST('/v1/patients', {
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
    return {
      status: 'error',
      formError: 'Something went wrong creating the patient. Please try again.',
      submittedValues,
    };
  }
  // POST /v1/patients' response isn't run through @ZodResponse
  // (patient.controller.ts's own header comment explains why — its shape is
  // {resourceId, before, after}, not documented in the OpenAPI schema, so
  // `data`'s generated type is `never`). openapi-fetch has already consumed
  // the body to populate `data` based on the response's real Content-Type
  // (JSON either way) — re-reading via `response.json()` would throw
  // "body already used", so this reads the same already-parsed `data`,
  // explicitly cast to the shape the controller actually returns.
  const created = data as unknown as { after: { mrn: string } };
  return { status: 'created', createdMrn: created.after.mrn };
}
