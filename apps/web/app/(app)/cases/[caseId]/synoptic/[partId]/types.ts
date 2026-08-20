// Split out from actions.ts -- same "'use server' file may only export
// async functions" constraint (frontend-design Skill entry #8).
import type { SynopticResponseResult } from '@lis/domain';

export interface RecordSynopticResponseState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
  result?: SynopticResponseResult;
}

export const recordSynopticResponseInitialState: RecordSynopticResponseState = {
  status: 'idle',
};
