'use server';

import {
  reportTemplateCreateSchema,
  reportTemplateVersionCreateSchema,
} from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { PublishVersionState, SaveTemplateState } from './types';

function parseDefinition(formData: FormData): unknown {
  const raw = formData.get('definition');
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * FEAT-047. Handles both "first save" (`POST /v1/report-templates`) and
 * "save as new version" (`POST /v1/report-templates/:id/versions`) --
 * distinguished by a hidden `templateId` field. Matches the proposal's own
 * §5 assumption: no update-draft endpoint exists, so every Save always
 * creates a brand-new version (or the first template), never edits one in
 * place. The canvas's own tree is submitted as a single JSON `definition`
 * hidden field, not individual form fields -- the payload is a nested
 * sections/fields tree the client already holds in state, not raw form
 * inputs, so `unitId`-style hidden-field submission
 * (`reference-ranges-table.tsx`'s own precedent) generalizes to "the whole
 * canvas," not one scalar value.
 */
export async function saveReportTemplate(
  _prevState: SaveTemplateState,
  formData: FormData,
): Promise<SaveTemplateState> {
  const templateId = formData.get('templateId');
  const testDefinitionId = formData.get('testDefinitionId');
  const definition = parseDefinition(formData);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  if (typeof templateId === 'string' && templateId.length > 0) {
    const parsed = reportTemplateVersionCreateSchema.safeParse({ definition });
    if (!parsed.success) {
      return {
        status: 'error',
        formError: 'The template canvas is invalid — check every section and field before saving.',
      };
    }
    const { data, response } = await client.POST('/v1/report-templates/{id}/versions', {
      params: { path: { id: templateId } },
      body: parsed.data,
    });
    if (!response.ok || !data) {
      if (response.status === 403) {
        return { status: 'error', formError: 'You do not have permission to edit report templates.' };
      }
      return {
        status: 'error',
        formError: 'Something went wrong saving this version. Please try again.',
      };
    }
    return { status: 'saved', savedVersion: data };
  }

  const parsed = reportTemplateCreateSchema.safeParse({ testDefinitionId, definition });
  if (!parsed.success) {
    return {
      status: 'error',
      formError: 'The template canvas is invalid — check every section and field before saving.',
    };
  }
  const { data, response } = await client.POST('/v1/report-templates', { body: parsed.data });
  if (!response.ok || !data) {
    if (response.status === 403) {
      return { status: 'error', formError: 'You do not have permission to create report templates.' };
    }
    if (response.status === 409) {
      return {
        status: 'error',
        formError: 'A report template already exists for this test — reload the page.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this template. Please try again.',
    };
  }
  return { status: 'saved', savedTemplate: data };
}

/**
 * The only code path that can ever set `status: 'published'`
 * (`report-template.controller.ts`'s own `publish()`) -- this action is a
 * thin call, never bypassable client-side logic. A 400 here means the
 * server-side analyte-binding/visibility guardrail rejected the definition
 * (KB-12) -- proven not bypassable by the designer's own client-side checks
 * (proposal AC #3).
 */
export async function publishReportTemplateVersion(
  _prevState: PublishVersionState,
  formData: FormData,
): Promise<PublishVersionState> {
  const templateId = formData.get('templateId');
  const versionId = formData.get('versionId');
  if (typeof templateId !== 'string' || typeof versionId !== 'string') {
    return { status: 'error', formError: 'Save a version before publishing.' };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST(
    '/v1/report-templates/{id}/versions/{versionId}/publish',
    { params: { path: { id: templateId, versionId } } },
  );
  if (!response.ok || !data) {
    if (response.status === 403) {
      return { status: 'error', formError: 'You do not have permission to publish report templates.' };
    }
    if (response.status === 409) {
      return { status: 'error', formError: 'This version is already published.' };
    }
    if (response.status === 400) {
      // Deliberately scenario-agnostic: report-template-guardrails.ts
      // rejects several distinct things (an unbound clinical field, an
      // out-of-set analyte binding, a duplicate field key, a
      // visibilityCondition on a table/richText field) -- this copy must
      // not presuppose which one actually failed.
      return {
        status: 'error',
        formError:
          'This template failed validation and cannot be published — check every section and field, then save a new version.',
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong publishing this version. Please try again.',
    };
  }
  return { status: 'published', publishedVersion: data };
}
