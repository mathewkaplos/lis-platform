// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime -- same fix `reference-ranges/types.ts` already
// established for this exact gap.

import type { InstrumentAnalyteMappingResult } from '@lis/domain';

export interface CreateInstrumentAnalyteMappingState {
  status: 'idle' | 'created' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  createdMapping?: InstrumentAnalyteMappingResult;
}

export const createInstrumentAnalyteMappingInitialState: CreateInstrumentAnalyteMappingState = {
  status: 'idle',
};
