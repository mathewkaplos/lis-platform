'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getValidAccessToken } from '@/auth/access-token';
import type {
  AddBlockState,
  AddOrderedTestState,
  AddSlideState,
  AmendCaseState,
  ScreenCaseState,
  SignOutCaseState,
  UpdateNarrativeState,
  UploadWholeSlideImageState,
} from './types';

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

/**
 * Issue #624. `POST /v1/cases/:id/screen` has no `@ZodResponse` and no
 * request body -- same raw-`fetch` precedent as `signOutCase` above. Unlike
 * `amendCase`/`signOutCase`, `screen()` has no `@RequireStepUp()` (confirmed
 * directly in the controller) -- no `step_up_required` branch to handle
 * here, a plain 403 always means a genuine permission denial.
 */
export async function screenCase(
  _prevState: ScreenCaseState,
  formData: FormData,
): Promise<ScreenCaseState> {
  const caseId = String(formData.get('caseId') ?? '');

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/cases/${caseId}/screen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    if (res.status === 403) {
      return { status: 'error', formError: 'You do not have permission to screen this case.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This case cannot be screened right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong screening this case. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}

/**
 * Issue #627. `POST /v1/cases/:id/blocks` has no `@ZodResponse` -- same
 * raw-`fetch` precedent as every prior action on this page. No
 * `step_up_required` branch (confirmed directly -- `addBlock()` has no
 * `@RequireStepUp()`), same as `screenCase`.
 */
export async function addBlock(
  _prevState: AddBlockState,
  formData: FormData,
): Promise<AddBlockState> {
  const caseId = String(formData.get('caseId') ?? '');
  const specimenId = String(formData.get('specimenId') ?? '');

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/cases/${caseId}/blocks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ specimenId }),
  });

  if (!res.ok) {
    if (res.status === 403) {
      return { status: 'error', formError: 'You do not have permission to add a block.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This block could not be added right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong adding this block. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}

/**
 * Issue #627. `POST /v1/blocks/:id/slides` has no `@ZodResponse` and no
 * request body -- same raw-`fetch` precedent as `addBlock` above. No
 * `step_up_required` branch (confirmed directly -- `addSlide()` has no
 * `@RequireStepUp()`).
 */
export async function addSlide(
  _prevState: AddSlideState,
  formData: FormData,
): Promise<AddSlideState> {
  const caseId = String(formData.get('caseId') ?? '');
  const blockId = String(formData.get('blockId') ?? '');

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/blocks/${blockId}/slides`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    if (res.status === 403) {
      return { status: 'error', formError: 'You do not have permission to add a slide.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This slide could not be added right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong adding this slide. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}

/**
 * Issue #630. `POST /v1/blocks/:id/ordered-tests` has no `@ZodResponse` --
 * same raw-`fetch` precedent as every prior action on this page. No
 * `step_up_required` branch (confirmed directly -- `addOrderedTest()` has
 * no `@RequireStepUp()`). `parentOrderedTestId` is deliberately never sent
 * from this manual UI (proposal §5) -- it's for the automated reflex-rule
 * engine's own lineage tracking, not a human picking a test from a
 * dropdown.
 */
export async function addOrderedTest(
  _prevState: AddOrderedTestState,
  formData: FormData,
): Promise<AddOrderedTestState> {
  const caseId = String(formData.get('caseId') ?? '');
  const blockId = String(formData.get('blockId') ?? '');
  const testDefinitionId = String(formData.get('testDefinitionId') ?? '');

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/blocks/${blockId}/ordered-tests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ testDefinitionId }),
  });

  if (!res.ok) {
    if (res.status === 403) {
      return { status: 'error', formError: 'You do not have permission to add a test.' };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return {
        status: 'error',
        formError: body?.detail ?? 'This test could not be added right now.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong adding this test. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}

/**
 * Issue #636. `PUT /v1/cases/:id/narrative` has no `@ZodResponse` -- same
 * raw-`fetch` precedent as every prior action on this page, for the same
 * reason: `AuditInterceptor` wraps every `@Audit()` route's return value
 * into `{resourceId, before, after, actorRole}` before it reaches the
 * client (confirmed directly in `audit.interceptor.ts` during backend
 * implementation), so there is no clean, documentable response shape to
 * type against. No `step_up_required` branch -- `updateNarrative()` has no
 * `@RequireStepUp()`. Only the fields actually present in the form are
 * sent, so a blank field means "don't touch this field," not "clear it" --
 * matching the route's own partial-update semantics.
 */
export async function updateNarrative(
  _prevState: UpdateNarrativeState,
  formData: FormData,
): Promise<UpdateNarrativeState> {
  const caseId = String(formData.get('caseId') ?? '');
  const body: Record<string, string> = {};
  for (const field of ['grossDescription', 'microscopicDescription', 'diagnosis'] as const) {
    const value = formData.get(field);
    if (value !== null) {
      body[field] = String(value);
    }
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const res = await fetch(`${baseUrl}/v1/cases/${caseId}/narrative`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to edit this case’s narrative.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong saving the narrative. Please try again.',
    };
  }

  revalidatePath(`/cases/${caseId}`);
  return { status: 'done' };
}
