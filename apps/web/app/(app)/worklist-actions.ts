'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { createLisApiClient } from '@/lib/api-client';

export interface BulkAssignOutcome {
  status: 'ok' | 'error';
  error?: string;
  updatedIds: string[];
  notFoundIds: string[];
}

export interface BulkCancelOutcome {
  status: 'ok' | 'error';
  error?: string;
  cancelledIds: string[];
  ineligibleIds: string[];
}

function writeErrorMessage(httpStatus: number): string {
  if (httpStatus === 403) return "You don't have permission to do that.";
  if (httpStatus === 401) return 'Your session has expired — please log in again.';
  return 'Something went wrong. Please try again.';
}

/**
 * FEAT-022 Part 2 (ADR-0024 decision 3): the only bulk-assign shape this
 * revision's own UI offers -- always sends the caller's own session `sub`,
 * never an arbitrary uuid. The API itself (`POST /v1/worklist/bulk-assign`)
 * accepts any uuid (ADR-0024 decision 2); this action is the UI-level
 * restriction to self-assign only, not an API-level one.
 */
export async function bulkAssignToMe(orderedTestIds: string[]): Promise<BulkAssignOutcome> {
  const [accessToken, session] = await Promise.all([getValidAccessToken(), getSession()]);
  if (!accessToken || !session) {
    return {
      status: 'error',
      error: 'Your session has expired — please log in again.',
      updatedIds: [],
      notFoundIds: [],
    };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST('/v1/worklist/bulk-assign', {
    body: { orderedTestIds, assignedUserId: session.sub },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), updatedIds: [], notFoundIds: [] };
  }
  return { status: 'ok', updatedIds: data.updatedIds, notFoundIds: data.notFoundIds };
}

/**
 * FEAT-022 Part 2 (proposal §1 finding #3): the API's own eligibility check
 * (only `'ordered'`-status rows) is the real filter -- this action sends
 * every selected id as-is and returns the real `{cancelledIds,
 * ineligibleIds}` split, so the UI can report partial results honestly
 * rather than a bare success/failure.
 */
export async function bulkCancelSelected(orderedTestIds: string[]): Promise<BulkCancelOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      error: 'Your session has expired — please log in again.',
      cancelledIds: [],
      ineligibleIds: [],
    };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST('/v1/worklist/bulk-cancel', {
    body: { orderedTestIds },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), cancelledIds: [], ineligibleIds: [] };
  }
  return { status: 'ok', cancelledIds: data.cancelledIds, ineligibleIds: data.ineligibleIds };
}
