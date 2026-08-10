// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (Next.js's own constraint — a plain object export
// like `initialState` throws `A "use server" file can only export async
// functions, found object` the moment a real request hits it, caught only
// by an actual browser check, not by typecheck/lint). Same fix
// `patients/new/types.ts` already established for this exact gap.

import type { ReferenceRangeResult } from '@lis/domain';

export interface CreateReferenceRangeState {
  status: 'idle' | 'created' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  createdRange?: ReferenceRangeResult;
}

export const createReferenceRangeInitialState: CreateReferenceRangeState = {
  status: 'idle',
};
