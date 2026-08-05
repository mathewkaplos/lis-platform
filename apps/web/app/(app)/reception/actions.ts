'use server';

import { specimenCreateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { ReceptionState } from './types';

/**
 * TASK-047 (FEAT-013 revision §5). One combined action, matching
 * specimen.controller.ts's own single `POST /v1/specimens` endpoint —
 * `rejectionReason`'s presence/absence (driven by which button the form
 * submitted, `intent`) is the accept/reject branch, not two separate
 * server actions. `orderedTestIds` come from a static checkbox list
 * (reception-form.tsx already has the order's ordered tests server-fetched)
 * — plain `formData.getAll()`, not the JSON-hidden-field sync
 * order-builder-form.tsx needs for its dynamic panel-expansion state.
 */
export async function receiveSpecimen(
  _prevState: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const intent = formData.get('intent');
  const orderId = String(formData.get('orderId') ?? '');
  const specimenType = String(formData.get('specimenType') ?? '');
  const orderedTestIds = formData.getAll('orderedTestIds').map(String);
  const rejectionReason =
    intent === 'reject' ? String(formData.get('rejectionReason') ?? '') : undefined;

  if (orderedTestIds.length === 0) {
    return {
      status: 'error',
      formError: 'Select at least one test this specimen fulfils.',
    };
  }

  const parsed = specimenCreateSchema.safeParse({
    orderId,
    specimenType,
    orderedTestIds,
    rejectionReason: rejectionReason || undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      formError:
        intent === 'reject' && !rejectionReason
          ? 'Select a rejection reason.'
          : 'Something went wrong with this submission. Please check the fields and try again.',
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

  const { data, response } = await client.POST('/v1/specimens', { body: parsed.data });
  if (!response.ok) {
    return {
      status: 'error',
      formError:
        response.status === 400
          ? 'This order has no eligible tests to receive, or the request was invalid.'
          : 'Something went wrong receiving this specimen. Please try again.',
    };
  }
  // POST /v1/specimens isn't run through @ZodResponse
  // (specimen.controller.ts's own header comment explains why — its shape
  // is {resourceId, before, after}, matching patient/order's own create()
  // convention).
  const created = data as unknown as {
    after: { accessionNumber: string; status: string; rejectionReason: string | null };
  };
  return {
    status: 'received',
    createdAccessionNumber: created.after.accessionNumber,
    createdStatus: created.after.status,
    createdRejectionReason: created.after.rejectionReason ?? undefined,
  };
}
