'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

export interface ResolveViolationOutcome {
  status: 'ok' | 'error';
  error?: string;
}

/**
 * TASK-070 (FEAT-020, ADR-0019 Decision 3). Calls the bare
 * `POST /v1/qc-rule-violations/:id/resolve` (no body), same imperative
 * Server Action shape as `results/actions.ts`'s own `verifyResult()` --
 * called from a Client Component's event handler via `useTransition`, not
 * `useActionState`-bound. The API's own `resolve_qc` capability guard
 * (`qa`-role only) is the real enforcement point; `hasQaRole()` only decides
 * whether this screen even shows the button that would call this.
 */
export async function resolveQcRuleViolation(
  violationId: string,
): Promise<ResolveViolationOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let response;
  try {
    ({ response } = await client.POST('/v1/qc-rule-violations/{id}/resolve', {
      params: { path: { id: violationId } },
    }));
  } catch {
    return { status: 'error', error: 'Something went wrong reaching the server. Please try again.' };
  }
  if (!response.ok) {
    if (response.status === 409) {
      return { status: 'error', error: 'This violation was already resolved.' };
    }
    if (response.status === 403) {
      return { status: 'error', error: 'You do not have permission to resolve QC violations.' };
    }
    return { status: 'error', error: 'Something went wrong resolving this violation. Please try again.' };
  }
  return { status: 'ok' };
}
