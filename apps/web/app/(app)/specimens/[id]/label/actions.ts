'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

export interface PrintLabelResult {
  status: 'printed' | 'error';
  formError?: string;
}

/**
 * TASK-046 (FEAT-013 revision §2/§10 Q1/Q2). No form data involved (just
 * `specimenId`), so this is a plain async function called directly from a
 * Client Component -- `cancel-order-button.tsx`'s own shape, not
 * `useActionState`. Records the audited print (`specimen.label_print`)
 * *before* `print-button.tsx` invokes `window.print()` -- if this call
 * fails, the print dialog never opens.
 */
export async function printSpecimenLabel(specimenId: string): Promise<PrintLabelResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
    };
  }
  const client = createLisApiClient(accessToken);

  const { response } = await client.POST('/v1/specimens/{id}/print', {
    params: { path: { id: specimenId } },
  });
  if (!response.ok) {
    return {
      status: 'error',
      formError: 'Something went wrong recording this print. Please try again.',
    };
  }
  return { status: 'printed' };
}
