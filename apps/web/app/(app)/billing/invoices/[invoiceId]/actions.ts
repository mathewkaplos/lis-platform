'use server';

import { paymentRequestSchema, type PaymentMethod } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { PaymentState } from './types';

function rawFormValues(formData: FormData) {
  return {
    method: formData.get('method') || undefined,
    amountCents: formData.get('amountCents')
      ? Number(formData.get('amountCents'))
      : undefined,
    reference: formData.get('reference') || undefined,
  };
}

/**
 * FEAT-046 (ADR-0041). `amountCents` is derived from a dollars-and-cents
 * text input server-side (see invoice-view.tsx), not sent as raw cents by
 * the form itself -- friendlier data entry for a cashier-facing screen.
 */
export async function recordPayment(
  invoiceId: string,
  _prevState: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const parsed = paymentRequestSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      formError:
        parsed.error.flatten().fieldErrors.amountCents?.[0] ??
        'Enter a valid payment amount and method.',
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

  const { response, error } = await client.POST('/v1/invoices/{id}/payments', {
    params: { path: { id: invoiceId } },
    body: {
      method: parsed.data.method as PaymentMethod,
      amountCents: parsed.data.amountCents,
      reference: parsed.data.reference,
    },
  });
  if (!response.ok) {
    if (response.status === 400) {
      // `ProblemDetailsFilter` (apps/api/src/common/problem-details.filter.ts)
      // puts the real reason in `detail` -- e.g. "already fully paid" vs.
      // "exceeds the remaining balance" are genuinely different situations
      // a cashier needs to see, not one blended fallback string.
      const detail = (error as { detail?: string } | undefined)?.detail;
      return {
        status: 'error',
        formError:
          detail ?? 'This invoice is already fully paid, or the amount is invalid.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong recording this payment. Please try again.',
    };
  }
  return { status: 'succeeded' };
}
