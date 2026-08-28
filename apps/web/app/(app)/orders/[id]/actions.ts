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

  let response;
  try {
    ({ response } = await client.POST('/v1/orders/{id}/cancel', {
      params: { path: { id: orderId } },
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server. Please try again.',
    };
  }
  if (!response.ok) {
    if (response.status === 409) {
      return {
        status: 'error',
        formError: 'No tests on this order are eligible for cancellation.',
      };
    }
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to cancel orders.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong cancelling this order. Please try again.',
    };
  }
  return { status: 'cancelled' };
}

export interface GenerateInvoiceResult {
  status: 'created' | 'error';
  invoiceId?: string;
  formError?: string;
}

/**
 * FEAT-046 (ADR-0041). Always creates a new invoice from the order's
 * current ordered tests -- this feature's approved scope doesn't include
 * duplicate-invoice prevention (a real, tracked simplification, not an
 * oversight -- see the billing Skill).
 *
 * Issue #704 (EPIC #697): if the order itself was booked against a
 * referring facility (chosen at order-entry time, `order-builder-form.tsx`'s
 * own "Referring facility" field), the invoice now bills that facility
 * (`payerType: 'corporate'`) automatically instead of always defaulting to
 * cash -- `generateInvoice()` (billing.service.ts) already supported this at
 * the API layer since FEAT-066; nothing in the UI ever passed it through
 * until now, confirmed via a repo-wide grep before writing this. A
 * cash-payer order (no referring facility set) is unaffected.
 */
export async function generateInvoice(
  orderId: string,
  referringFacilityId?: string | null,
): Promise<GenerateInvoiceResult> {
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
    ({ data, response } = await client.POST('/v1/orders/{id}/invoice', {
      params: { path: { id: orderId } },
      body: referringFacilityId
        ? { payerType: 'corporate', referringFacilityId }
        : {},
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server. Please try again.',
    };
  }
  if (!response.ok) {
    if (response.status === 400) {
      return {
        status: 'error',
        formError:
          'One or more tests on this order have no price configured — cannot generate an invoice.',
      };
    }
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to generate invoices.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong generating this invoice. Please try again.',
    };
  }
  const created = data as unknown as { after: { id: string } };
  return { status: 'created', invoiceId: created.after.id };
}
