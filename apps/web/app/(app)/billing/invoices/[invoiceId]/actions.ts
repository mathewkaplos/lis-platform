'use server';

import { paymentRequestSchema, type PaymentMethod } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { PaymentState, SendInvoiceEmailState } from './types';

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

  let response, error;
  try {
    ({ response, error } = await client.POST('/v1/invoices/{id}/payments', {
      params: { path: { id: invoiceId } },
      body: {
        method: parsed.data.method as PaymentMethod,
        amountCents: parsed.data.amountCents,
        reference: parsed.data.reference,
      },
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server — your payment was not recorded, please try again.',
    };
  }
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
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to record payments.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong recording this payment. Please try again.',
    };
  }
  return { status: 'succeeded' };
}

/**
 * Issue #711 (docs/plans/task-711-invoice-email-delivery.md). Same typed-
 * client + `as unknown as {...}` cast `generateInvoice()` (orders/[id]/
 * actions.ts) already uses for this controller's un-`@ZodResponse`'d
 * audited responses -- not raw `fetch`, matching this directory's own
 * established convention (unlike `cases/[caseId]/actions.ts`, which uses
 * raw fetch throughout for the same underlying reason). An empty `to`
 * field is sent as `undefined`, not an empty string -- the server resolves
 * the patient's own on-file email in that case; an empty string would
 * instead fail `z.email()` validation as a real 400.
 */
export async function sendInvoiceEmail(
  invoiceId: string,
  _prevState: SendInvoiceEmailState,
  formData: FormData,
): Promise<SendInvoiceEmailState> {
  const to = String(formData.get('to') ?? '').trim();

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
    };
  }
  const client = createLisApiClient(accessToken);

  let data, response, error;
  try {
    ({ data, response, error } = await client.POST(
      '/v1/invoices/{id}/send-email',
      {
        params: { path: { id: invoiceId } },
        body: { to: to || undefined },
      },
    ));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server. Please try again.',
    };
  }

  if (!response.ok) {
    if (response.status === 400) {
      const detail = (error as { detail?: string } | undefined)?.detail;
      return {
        status: 'error',
        formError: detail ?? 'This invoice could not be emailed right now.',
      };
    }
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to email this invoice.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong sending this email. Please try again.',
    };
  }

  const sent = data as unknown as { after: { sentTo: string } };
  return { status: 'done', sentTo: sent.after.sentTo };
}
