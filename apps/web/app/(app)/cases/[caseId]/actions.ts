'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getValidAccessToken } from '@/auth/access-token';
import type { AmendCaseState, SignOutCaseState, UploadWholeSlideImageState } from './types';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). `POST /v1/whole-slide-
 * images/slides/:slideId` has no documented request body in the OpenAPI
 * spec (it reads the multipart file directly via `request.file()`, no
 * `@Body()`) -- same "undocumented shape" situation `registerPatient`'s
 * own header comment already documents for a different route's response.
 * A raw `fetch` call, not the typed `@lis/sdk` client, matching that same
 * established precedent for anything the generated types can't express.
 */
export async function uploadWholeSlideImage(
  _prevState: UploadWholeSlideImageState,
  formData: FormData,
): Promise<UploadWholeSlideImageState> {
  const slideId = String(formData.get('slideId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', formError: 'Select a .zip file to upload.' };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const uploadBody = new FormData();
  uploadBody.set('file', file);

  const res = await fetch(`${baseUrl}/v1/whole-slide-images/slides/${slideId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: uploadBody,
  });

  if (!res.ok) {
    if (res.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to upload whole-slide images.',
      };
    }
    if (res.status === 400) {
      return { status: 'error', formError: 'Unknown slide — please refresh and try again.' };
    }
    return {
      status: 'error',
      formError: 'Something went wrong uploading this file. Please try again.',
    };
  }

  const body = (await res.json()) as {
    status: 'processing' | 'ready' | 'failed';
    errorMessage: string | null;
  };
  return {
    status: 'done',
    resultStatus: body.status === 'ready' ? 'ready' : 'failed',
    resultErrorMessage: body.errorMessage,
  };
}

/**
 * Issue #615. `POST /v1/cases/:id/amend` has no `@ZodResponse` (same
 * undocumented-shape situation `uploadWholeSlideImage` above already
 * documents) -- a raw `fetch`, not the typed `@lis/sdk` client.
 *
 * `apps/api`'s `ProblemDetailsFilter` (`apps/api/src/common/problem-details.filter.ts`)
 * puts a machine-readable `code: 'step_up_required'` on a `StepUpRequiredException`'s
 * 403 body -- confirmed by reading that file directly, not assumed. This is the
 * first real caller anywhere in `apps/web` of the `step_up=1` re-authentication
 * redirect `apps/web/app/api/auth/login/route.ts` has carried since FEAT-059
 * but that nothing before this action ever actually triggered.
 */
export async function amendCase(
  _prevState: AmendCaseState,
  formData: FormData,
): Promise<AmendCaseState> {
  const caseId = String(formData.get('caseId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) {
    return { status: 'error', formError: 'Enter a reason for this amendment.' };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/cases/${caseId}/amend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === 'step_up_required') {
        redirect(`/api/auth/login?step_up=1&rd=${encodeURIComponent(`/cases/${caseId}`)}`);
      }
      return { status: 'error', formError: 'You do not have permission to amend this case.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This case cannot be amended right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong submitting this amendment. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}

/**
 * Issue #621. `POST /v1/cases/:id/finalize` has no `@ZodResponse` and no
 * request body -- same raw-`fetch` precedent as `amendCase` above, minus a
 * form field to read. Second real caller (after `amendCase`) of the
 * `step_up=1` redirect -- same branch, already proven working end-to-end by
 * issue #615's own live browser verification.
 */
export async function signOutCase(
  _prevState: SignOutCaseState,
  formData: FormData,
): Promise<SignOutCaseState> {
  const caseId = String(formData.get('caseId') ?? '');

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/cases/${caseId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === 'step_up_required') {
        redirect(`/api/auth/login?step_up=1&rd=${encodeURIComponent(`/cases/${caseId}`)}`);
      }
      return { status: 'error', formError: 'You do not have permission to sign out this case.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This case cannot be signed out right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong signing out this case. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}
