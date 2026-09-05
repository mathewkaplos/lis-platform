'use server';

import { revalidatePath } from 'next/cache';
import { specimenProcessingBatchCreateSchema, type SpecimenProcessingBatch } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { RecordBatchState } from './types';

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md,
 * issue #795). v1 UI scope is narrower than the API it calls: the API
 * accepts N cases per batch (matching the real tracking sheet's own
 * multi-row manifest), but this form records one case per submission --
 * a real, disclosed scope narrowing for the UI layer only, not the backend
 * (see the PR description). A lab covering several cases in one physical
 * batch submits this form once per case for now.
 */
function rawFormValues(formData: FormData) {
  return {
    histoTechName: formData.get('histoTechName') || undefined,
    grossingDate: formData.get('grossingDate')
      ? `${formData.get('grossingDate')}T00:00:00.000Z`
      : undefined,
    slidesForwardedDate: formData.get('slidesForwardedDate')
      ? `${formData.get('slidesForwardedDate')}T00:00:00.000Z`
      : undefined,
    tissueFixation: formData.get('tissueFixation') || undefined,
    processing: formData.get('processing') || undefined,
    sectionThickness: formData.get('sectionThickness') || undefined,
    tissueFoldsTears: formData.get('tissueFoldsTears') || undefined,
    stainingQuality: formData.get('stainingQuality') || undefined,
    coverslipping: formData.get('coverslipping') || undefined,
    tissueOrientation: formData.get('tissueOrientation') || undefined,
    comments: formData.get('comments') || undefined,
    correctiveAction: formData.get('correctiveAction') || undefined,
    cases: [
      {
        caseId: formData.get('caseId') || undefined,
        slideCount: formData.get('slideCount') ? Number(formData.get('slideCount')) : undefined,
        pathologistRemarks: formData.get('pathologistRemarks') || undefined,
      },
    ],
  };
}

export async function recordSpecimenProcessingBatch(
  _prevState: RecordBatchState,
  formData: FormData,
): Promise<RecordBatchState> {
  const parsed = specimenProcessingBatchCreateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let data, response;
  try {
    ({ data, response } = await client.POST('/v1/specimen-processing-batches', {
      body: parsed.data,
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server — your data was not saved, please try again.',
    };
  }
  if (!response.ok || !data) {
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to record a specimen-processing QC batch.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong recording this batch. Please try again.',
    };
  }
  // POST /v1/specimen-processing-batches isn't run through @ZodResponse
  // (specimen-processing-qc.controller.ts's own header comment explains why
  // -- its shape is {resourceId, before, after}, matching every other
  // audited create() in this repo, so `data`'s generated type is `never`).
  const created = data as unknown as { after: SpecimenProcessingBatch };
  revalidatePath('/specimen-processing-qc');
  return { status: 'created', createdBatch: created.after };
}
