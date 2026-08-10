'use server';

import { revalidatePath } from 'next/cache';
import { acknowledgeCriticalNotificationSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { AcknowledgeCriticalState } from './types';

/**
 * FEAT-038 (proposal §2): the dashboard's own critical-acknowledgement
 * action, against `/v1/clinician/critical-notifications/:id/acknowledge`
 * (own-patient ABAC scoped). `revalidatePath` refreshes the dashboard's
 * pending-criticals list on success -- the acknowledged row must not still
 * appear as actionable after this returns.
 */
export async function acknowledgeCritical(
  _prevState: AcknowledgeCriticalState,
  formData: FormData,
): Promise<AcknowledgeCriticalState> {
  const id = String(formData.get('notificationId') ?? '');
  const parsed = acknowledgeCriticalNotificationSchema.safeParse({
    readBack: formData.get('readBack'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      formError: 'A documented read-back is required.',
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

  const { response } = await client.POST(
    '/v1/clinician/critical-notifications/{id}/acknowledge',
    { params: { path: { id } }, body: parsed.data },
  );
  if (!response.ok) {
    return {
      status: 'error',
      formError: 'Something went wrong acknowledging this critical. Please try again.',
    };
  }
  revalidatePath('/clinician');
  return { status: 'acknowledged' };
}
