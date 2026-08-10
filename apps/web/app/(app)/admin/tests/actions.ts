'use server';

import { testDefinitionCreateSchema, type TestDefinitionResult } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateTestState } from './types';

function rawFormValues(formData: FormData) {
  return {
    code: formData.get('code') || undefined,
    displayName: formData.get('displayName') || undefined,
    analyteIds: formData.getAll('analyteIds').filter(Boolean),
  };
}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). Binds only already-
 * existing global analytes -- analyte creation is out of scope (§10 Q1);
 * `POST /v1/test-definitions` itself rejects an empty `analyteIds` array
 * (400), matching this schema's own `.min(1)`.
 */
export async function createTest(
  _prevState: CreateTestState,
  formData: FormData,
): Promise<CreateTestState> {
  const parsed = testDefinitionCreateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST('/v1/test-definitions', {
    body: parsed.data,
  });
  if (!response.ok) {
    if (response.status === 403) {
      return { status: 'error', formError: 'You do not have permission to add tests.' };
    }
    if (response.status === 400) {
      return {
        status: 'error',
        formError: 'One or more selected analytes could not be found. Please retry.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this test. Please try again.',
    };
  }
  // Same untyped-audited-route cast as `patients/new/actions.ts`'s own
  // `registerPatient()` -- `engineering/api-design` Skill entry #15.
  const created = data as unknown as { after: TestDefinitionResult };
  return { status: 'created', createdTest: created.after };
}
