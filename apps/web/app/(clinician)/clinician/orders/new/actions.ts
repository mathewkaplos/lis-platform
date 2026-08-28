'use server';

import { orderCreateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateOrderState } from '../../../../(app)/orders/new/types';

/**
 * FEAT-038: the clinician-facing twin of `(app)/orders/new/actions.ts`'s
 * `createOrder` -- identical body validation/shape, the only real
 * difference is the endpoint (`/v1/clinician/orders`, own-patient ABAC
 * scoped) and its 404-on-unrelated-patient response, which reads as the
 * same generic "went wrong" message here (a clinician should never reach
 * this form for a patient they can't see in the first place -- the
 * dashboard/results links only ever point at related patients).
 */
export async function createClinicianOrder(
  _prevState: CreateOrderState,
  formData: FormData,
): Promise<CreateOrderState> {
  const patientId = String(formData.get('patientId') ?? '');
  let testDefinitionIds: string[];
  let panelIds: string[];
  try {
    testDefinitionIds = JSON.parse(String(formData.get('testDefinitionIds') ?? '[]'));
    panelIds = JSON.parse(String(formData.get('panelIds') ?? '[]'));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reading your selection. Please try again.',
    };
  }

  const priority = formData.get('priority');
  const parsed = orderCreateSchema.safeParse({
    patientId,
    testDefinitionIds: testDefinitionIds.length > 0 ? testDefinitionIds : undefined,
    panelIds: panelIds.length > 0 ? panelIds : undefined,
    priority: priority || undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      formError:
        testDefinitionIds.length === 0 && panelIds.length === 0
          ? 'Select at least one test or panel.'
          : 'Something went wrong with your selection. Please try again.',
    };
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
    ({ data, response } = await client.POST('/v1/clinician/orders', {
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
        formError: 'You do not have permission to place orders.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong placing the order. Please try again.',
    };
  }
  // Not run through @ZodResponse (clinician.controller.ts's own header
  // comment on createOrder explains why), same explicit cast as the staff
  // action's identical situation.
  const created = data as unknown as {
    resourceId: string;
    after: { orderedTests: unknown[] };
  };
  return {
    status: 'created',
    createdOrderId: created.resourceId,
    createdTestCount: created.after.orderedTests.length,
  };
}
