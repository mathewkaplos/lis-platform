'use server';

import {
  instrumentAnalyteMappingCreateSchema,
  type InstrumentAnalyteMappingResult,
} from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateInstrumentAnalyteMappingState } from './types';

function rawFormValues(formData: FormData) {
  return {
    instrumentId: formData.get('instrumentId') || undefined,
    channelCode: formData.get('channelCode') || undefined,
    analyteId: formData.get('analyteId') || undefined,
    unitId: formData.get('unitId') || undefined,
    conversionFactor: formData.get('conversionFactor')
      ? Number(formData.get('conversionFactor'))
      : undefined,
  };
}

/**
 * Issue #812 (docs/plans/task-812-instrument-analyte-mapping-admin-ui.md).
 * §10 Q1 (resolved): the form never submits `status` -- the controller
 * defaults an omitted `status` to `'published'`, matching the real
 * immediate need (a working config path for a simulated/real analyzer
 * today, not a draft/review workflow).
 */
export async function createInstrumentAnalyteMapping(
  _prevState: CreateInstrumentAnalyteMappingState,
  formData: FormData,
): Promise<CreateInstrumentAnalyteMappingState> {
  const parsed = instrumentAnalyteMappingCreateSchema.safeParse(rawFormValues(formData));
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

  let data, response;
  try {
    ({ data, response } = await client.POST('/v1/instrument-analyte-mappings', {
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
        formError: 'You do not have permission to add instrument mappings.',
      };
    }
    if (response.status === 409) {
      return {
        status: 'error',
        formError:
          'A published mapping already exists for this instrument/channel — archive it first.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this mapping. Please try again.',
    };
  }
  // Same untyped-audited-route cast as `reference-ranges/actions.ts`'s own
  // `createReferenceRange()` -- this route's response isn't run through
  // `@ZodResponse` (its shape is {resourceId, before, after}).
  const created = data as unknown as { after: InstrumentAnalyteMappingResult };
  return { status: 'created', createdMapping: created.after };
}
