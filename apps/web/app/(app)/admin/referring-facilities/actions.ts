'use server';

import { referringFacilityCreateSchema, type ReferringFacility } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateReferringFacilityState } from './types';

function rawFormValues(formData: FormData) {
  return {
    name: formData.get('name') || undefined,
    phone: formData.get('phone') || undefined,
    email: formData.get('email') || undefined,
    address: formData.get('address') || undefined,
  };
}

/**
 * FEAT-066 (docs/plans/feat-066-patient-contact-referring-facility.md,
 * ADR-0053). Mirrors `admin/tests/actions.ts`'s own create-only shape.
 */
export async function createReferringFacility(
  _prevState: CreateReferringFacilityState,
  formData: FormData,
): Promise<CreateReferringFacilityState> {
  const parsed = referringFacilityCreateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let data, response;
  try {
    ({ data, response } = await client.POST('/v1/referring-facilities', {
      body: parsed.data,
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server — your data was not saved, please try again.',
    };
  }
  if (!response.ok) {
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to add referring facilities.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this referring facility. Please try again.',
    };
  }
  // Same untyped-audited-route cast as `admin/tests/actions.ts`'s own
  // `createTest()` -- `engineering/api-design` Skill entry #15.
  const created = data as unknown as { after: ReferringFacility };
  return { status: 'created', createdFacility: created.after };
}
