'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

export interface AcknowledgeCriticalNotificationOutcome {
  status: 'ok' | 'error';
  error?: string;
}

/**
 * Issue #809. Calls the real `POST /v1/critical-notifications/:id/acknowledge`
 * (already built, TASK-065/ADR-0016) -- same imperative Server Action shape
 * as `qc-violations/actions.ts`'s own `resolveQcRuleViolation`, called from a
 * Client Component's event handler via `useTransition`. The API's own
 * `verify` capability guard is the real enforcement point; `canAcknowledge`
 * on the table only decides whether this screen even shows the control that
 * would call this.
 */
export async function acknowledgeCriticalNotification(
  notificationId: string,
  readBack: string,
): Promise<AcknowledgeCriticalNotificationOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let response;
  try {
    ({ response } = await client.POST('/v1/critical-notifications/{id}/acknowledge', {
      params: { path: { id: notificationId } },
      body: { readBack },
    }));
  } catch {
    return { status: 'error', error: 'Something went wrong reaching the server. Please try again.' };
  }
  if (!response.ok) {
    if (response.status === 409) {
      return { status: 'error', error: 'This notification was already acknowledged.' };
    }
    if (response.status === 403) {
      return { status: 'error', error: 'You do not have permission to acknowledge critical notifications.' };
    }
    return { status: 'error', error: 'Something went wrong acknowledging this notification. Please try again.' };
  }
  return { status: 'ok' };
}
