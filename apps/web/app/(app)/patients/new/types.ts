// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (Next.js's own constraint — a plain object export
// like `initialState` throws `A "use server" file can only export async
// functions, found object` the moment a real request hits it, caught only
// by an actual browser check, not by typecheck/lint). Types are erased at
// compile time either way, but `initialState` is a genuine runtime value,
// so it has to live outside the action file.

export interface DuplicateMatch {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
}

export interface SubmittedValues {
  firstName: string;
  middleName: string;
  lastName: string;
  sex: string;
  birthDate: string;
  nationalId: string;
}

export interface RegisterPatientState {
  status: 'idle' | 'error' | 'duplicate-found' | 'created';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  duplicateMatch?: DuplicateMatch;
  createdMrn?: string;
  // Echoed back so the client can re-render the form with what the user
  // typed — both for the duplicate-confirm resubmission (hidden inputs
  // carrying the exact values forward, not read back out of the DOM, which
  // would be ambiguous once a second copy of the same field names exists on
  // the page) and so a validation error doesn't silently discard input.
  submittedValues?: SubmittedValues;
}

export const registerPatientInitialState: RegisterPatientState = {
  status: 'idle',
};
