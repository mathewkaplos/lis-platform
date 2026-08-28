'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

export interface RecordCultureReadOutcome {
  status: 'ok' | 'error';
  error?: string;
}

/**
 * FEAT-052 (ADR-0046). Calls `POST /v1/culture-reads/:id/record` -- always a
 * human-initiated action, same imperative Server Action shape
 * `qc-violations/actions.ts`'s own `resolveQcRuleViolation()` already
 * established. The API's own `enter_result` capability guard is the real
 * enforcement point; this screen shows the buttons to anyone who reaches it
 * and surfaces a 403 inline if the caller's role turns out not to have it.
 */
export async function recordCultureRead(
  cultureReadId: string,
  result: 'no_growth' | 'growth',
): Promise<RecordCultureReadOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let response;
  try {
    ({ response } = await client.POST('/v1/culture-reads/{id}/record', {
      params: { path: { id: cultureReadId } },
      body: { result },
    }));
  } catch {
    return { status: 'error', error: 'Something went wrong reaching the server. Please try again.' };
  }
  if (!response.ok) {
    if (response.status === 400) {
      return { status: 'error', error: 'This culture read was already recorded.' };
    }
    if (response.status === 403) {
      return { status: 'error', error: 'You do not have permission to record culture reads.' };
    }
    return { status: 'error', error: 'Something went wrong recording this read. Please try again.' };
  }
  return { status: 'ok' };
}
