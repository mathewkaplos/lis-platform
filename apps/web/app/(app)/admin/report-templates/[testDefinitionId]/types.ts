// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime -- same fix `admin/tests/types.ts`/`patients/new/
// types.ts` already established for this exact gap.

import type { ReportTemplateResult, ReportTemplateVersionResult } from '@lis/domain';

export interface SaveTemplateState {
  status: 'idle' | 'saved' | 'error';
  formError?: string;
  savedTemplate?: ReportTemplateResult;
  savedVersion?: ReportTemplateVersionResult;
}

export const saveTemplateInitialState: SaveTemplateState = { status: 'idle' };

export interface PublishVersionState {
  status: 'idle' | 'published' | 'error';
  formError?: string;
  publishedVersion?: ReportTemplateVersionResult;
}

export const publishVersionInitialState: PublishVersionState = { status: 'idle' };
