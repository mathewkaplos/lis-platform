'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

export interface CancelOrderResult {
  status: 'cancelled' | 'error';
  formError?: string;
}

/**
 * TASK-044 (FEAT-012 proposal §5). No form data involved (just `orderId` +
 * a confirm step, owned by `cancel-order-button.tsx`), so this is a plain
 * async function called directly from a Client Component -- not wired
 * through `useActionState`/a `<form>`, unlike `patients/new`'s own Server
 * Action (which genuinely has field data to carry).
 */
export async function cancelOrder(orderId: string): Promise<CancelOrderResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
    };
  }
  const client = createLisApiClient(accessToken);

  const { response } = await client.POST('/v1/orders/{id}/cancel', {
    params: { path: { id: orderId } },
  });
  if (!response.ok) {
    if (response.status === 409) {
      return {
        status: 'error',
        formError: 'No tests on this order are eligible for cancellation.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong cancelling this order. Please try again.',
    };
  }
  return { status: 'cancelled' };
}
