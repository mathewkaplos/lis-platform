// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (patients/new/types.ts's own header comment explains
// the exact failure this avoids).

export interface ReceptionState {
  status: 'idle' | 'error' | 'received';
  formError?: string;
  createdSpecimenId?: string;
  createdAccessionNumber?: string;
  createdStatus?: string;
  createdRejectionReason?: string;
}

export const receptionInitialState: ReceptionState = {
  status: 'idle',
};
