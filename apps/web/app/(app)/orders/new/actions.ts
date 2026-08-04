'use server';

import { orderCreateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateOrderState } from './types';

/**
 * TASK-043 (FEAT-012 proposal §5). Selected test/panel ids arrive as
 * JSON-encoded hidden-field values (synced from `order-builder-form.tsx`'s
 * own selection state on every change) -- not read back out of a variable
 * number of checkbox DOM nodes, which doesn't compose cleanly with native
 * form serialization for a dynamic list. Same "state resubmitted via a
 * hidden field" convention `patients/new/actions.ts`'s duplicate-confirm
 * resubmission already established.
 *
 * The server (order.controller.ts) independently expands panels into their
 * member tests and dedupes -- this action sends exactly what was checked,
 * never re-derives the expansion client-side.
 */
export async function createOrder(
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

  const { data, response } = await client.POST('/v1/orders', { body: parsed.data });
  if (!response.ok) {
    return {
      status: 'error',
      formError: 'Something went wrong placing the order. Please try again.',
    };
  }
  // POST /v1/orders isn't run through @ZodResponse (order.controller.ts's
  // own header comment on `create` explains why -- its shape is
  // {resourceId, before, after}, not documented in the OpenAPI schema, so
  // `data`'s generated type is `never`), matching patients/new/actions.ts's
  // identical situation and identical explicit cast.
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
