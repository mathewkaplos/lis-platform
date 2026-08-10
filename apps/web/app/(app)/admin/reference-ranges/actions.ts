'use server';

import { referenceRangeCreateSchema, type ReferenceRangeResult } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateReferenceRangeState } from './types';

function rawFormValues(formData: FormData) {
  return {
    analyteId: formData.get('analyteId') || undefined,
    unitId: formData.get('unitId') || undefined,
    sex: formData.get('sex') || undefined,
    ageLowDays: formData.get('ageLowDays') ? Number(formData.get('ageLowDays')) : undefined,
    ageHighDays: formData.get('ageHighDays') ? Number(formData.get('ageHighDays')) : undefined,
    condition: formData.get('condition') || undefined,
    method: formData.get('method') || undefined,
    rangeType: formData.get('rangeType') || undefined,
    low: formData.get('low') ? Number(formData.get('low')) : undefined,
    high: formData.get('high') ? Number(formData.get('high')) : undefined,
    textualRange: formData.get('textualRange') || undefined,
    source: formData.get('source') || undefined,
  };
}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). Add-only (§10 Q3) --
 * `POST /v1/reference-ranges` never accepts an `effectiveTo`; ending an
 * existing range is explicitly out of this feature's own scope. `unitId`
 * is submitted as a hidden field, populated client-side from the selected
 * analyte's own `defaultUnitId` (`page.tsx`'s own header comment) -- no
 * unit picker exists in this form.
 */
export async function createReferenceRange(
  _prevState: CreateReferenceRangeState,
  formData: FormData,
): Promise<CreateReferenceRangeState> {
  const parsed = referenceRangeCreateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
    };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST('/v1/reference-ranges', {
    body: parsed.data,
  });
  if (!response.ok) {
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to add reference ranges.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this reference range. Please try again.',
    };
  }
  // Same untyped-audited-route cast as `patients/new/actions.ts`'s own
  // `registerPatient()` -- this route's response isn't run through
  // `@ZodResponse` (its shape is {resourceId, before, after}, matching
  // `engineering/api-design` Skill entry #15's own documented gap).
  const created = data as unknown as { after: ReferenceRangeResult };
  return { status: 'created', createdRange: created.after };
}
