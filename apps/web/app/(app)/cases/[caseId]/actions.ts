'use server';

import { getValidAccessToken } from '@/auth/access-token';
import type { UploadWholeSlideImageState } from './types';

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
