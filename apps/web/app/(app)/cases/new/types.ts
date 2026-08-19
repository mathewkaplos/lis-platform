// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (patients/new/types.ts's own header comment explains
// the exact failure this avoids — a plain object export throws only when a
// real request hits it, invisible to typecheck/lint).

export interface CreateCaseState {
  status: 'idle' | 'error' | 'created';
  formError?: string;
  createdCaseId?: string;
  createdAccessionNumber?: string;
}

export const createCaseInitialState: CreateCaseState = {
  status: 'idle',
};
