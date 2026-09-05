// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (Next.js's own constraint — a plain object export
// like `initialState` throws at real-request time, not at typecheck/lint).
// Same fix `patients/new/types.ts` already established for this exact gap
// (`frontend-design` Skill entry #8).

import type { SpecimenProcessingBatch } from '@lis/domain';

export interface RecordBatchState {
  status: 'idle' | 'created' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  createdBatch?: SpecimenProcessingBatch;
}

export const recordBatchInitialState: RecordBatchState = {
  status: 'idle',
};
