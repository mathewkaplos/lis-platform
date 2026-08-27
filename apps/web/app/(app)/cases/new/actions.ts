'use server';

import { caseCreateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateCaseState } from './types';

/**
 * Issue #633. `POST /v1/cases`'s request body is fully documented in
 * `openapi.json` (confirmed directly), only its response has no
 * `@ZodResponse` (bare `201`, no content schema) -- same situation
 * `orders/new/actions.ts`'s own `createOrder` already documents for its
 * sibling route. Uses the typed `@lis/sdk` client for the (typed) request,
 * with the same explicit cast `createOrder` uses for the (untyped)
 * response, rather than raw `fetch` -- unlike the case-detail-page actions
 * (`amendCase`/`signOutCase`/etc.), whose own *request* shapes are
 * undocumented too (multipart or bodyless), which is why those went raw.
 */
export async function createCase(
  _prevState: CreateCaseState,
  formData: FormData,
): Promise<CreateCaseState> {
  const orderId = String(formData.get('orderId') ?? '');
  let parts: unknown;
  try {
    parts = JSON.parse(String(formData.get('parts') ?? '[]'));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reading the specimen parts. Please try again.',
    };
  }

  const parsed = caseCreateSchema.safeParse({ orderId, parts });
  if (!parsed.success) {
    return {
      status: 'error',
      formError:
        Array.isArray(parts) && parts.length === 0
          ? 'Add at least one specimen part.'
          : 'Enter a specimen type for every part.',
    };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  const { data, error, response } = await client.POST('/v1/cases', { body: parsed.data });
  if (!response.ok) {
    // Issue #768: a capability-guard denial's `detail` is a technical
    // message (CapabilityGuard's own "No role grants the '...' capability"),
    // not something to show a user -- checked before falling back to it.
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to accession cases.',
      };
    }
    // openapi-fetch already parses the response body into `error` for a
    // non-ok response (ProblemDetailsFilter's `application/problem+json`
    // content-type parses the same as plain JSON) -- reading `response`
    // again here would throw ("body stream already read"), so this reuses
    // the already-parsed value rather than calling `response.json()` a
    // second time.
    const problem = error as unknown as { detail?: string } | undefined;
    return {
      status: 'error',
      formError:
        problem?.detail ?? 'Something went wrong accessioning this case. Please try again.',
    };
  }

  // See header comment: POST /v1/cases has no @ZodResponse, so `data`'s
  // generated type is `never` -- same explicit cast createOrder uses.
  const created = data as unknown as {
    resourceId: string;
    after: { accessionNumber: string };
  };
  return {
    status: 'created',
    createdCaseId: created.resourceId,
    createdAccessionNumber: created.after.accessionNumber,
  };
}
