// Split out from actions.ts -- same "'use server' file may only export
// async functions" constraint `reference-ranges/types.ts`/`patients/new/
// types.ts` already document.

import type { TestDefinitionResult } from '@lis/domain';

export interface CreateTestState {
  status: 'idle' | 'created' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  createdTest?: TestDefinitionResult;
}

export const createTestInitialState: CreateTestState = { status: 'idle' };
