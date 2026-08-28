'use server';

import { getValidAccessToken } from '@/auth/access-token';
import type { RecordSynopticResponseState } from './types';

export interface RecordSynopticResponsePayload {
  caseId: string;
  orderedTestId: string;
  // Issue #674: the specimen (part) this recording belongs to.
  specimenId: string;
  synopticProtocolVersionId: string;
  responses: { elementKey: string; value: string | number | string[] }[];
}

/**
 * issue #642 (proposal §7). `POST /v1/cases/:id/synoptic-responses` has no
 * `@Audit()`/`AuditInterceptor` wrapping (it writes its own audit event
 * inside `assembleAndPersistSynopticResponse`, per that route's own header
 * comment) -- the response is exactly `SynopticResponseResult`, not the
 * `{resourceId, before, after, actorRole}` shape issue #636/#639 both had to
 * account for. A raw `fetch`, matching every other `apps/web` action against
 * an undocumented-by-`@ZodResponse` route in this file.
 *
 * `useActionState`'s dispatch accepts any payload type when called
 * programmatically (not bound to `<form action={dispatch}>`) -- this form's
 * own dynamic, protocol-driven field set can't be expressed as a single
 * native `FormData` submission the way every other form on this page can,
 * so `protocol-form.tsx` calls this action directly with a plain object.
 */
export async function recordSynopticResponse(
  _prevState: RecordSynopticResponseState,
  payload: RecordSynopticResponsePayload,
): Promise<RecordSynopticResponseState> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/cases/${payload.caseId}/synoptic-responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderedTestId: payload.orderedTestId,
        specimenId: payload.specimenId,
        synopticProtocolVersionId: payload.synopticProtocolVersionId,
        responses: payload.responses,
      }),
    });
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server — your response was not saved, please try again.',
    };
  }

  if (!res.ok) {
    if (res.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to record a synoptic protocol on this case.',
      };
    }
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    return {
      status: 'error',
      formError: body?.detail ?? 'Something went wrong recording this synoptic protocol. Please try again.',
    };
  }

  const result = (await res.json()) as RecordSynopticResponseState['result'];
  return { status: 'done', result };
}
