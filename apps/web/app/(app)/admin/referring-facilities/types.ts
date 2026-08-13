// Split out from actions.ts -- same "'use server' file may only export
// async functions" constraint `admin/tests/types.ts`'s own header comment
// already documents.

import type { ReferringFacility } from '@lis/domain';

export interface CreateReferringFacilityState {
  status: 'idle' | 'created' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  createdFacility?: ReferringFacility;
}

export const createReferringFacilityInitialState: CreateReferringFacilityState = {
  status: 'idle',
};
