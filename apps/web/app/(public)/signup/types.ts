// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (`engineering/frontend-design` entry #8 — a plain
// object export throws only when a real request hits it, never at
// typecheck/lint/build). initialState is a genuine runtime value, so it
// lives outside the action file, same as every other create-form in this
// repo (patients/new/types.ts, admin/tests/types.ts).

export interface SubmittedValues {
  orgName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
}

export interface SignUpState {
  status: 'idle' | 'error' | 'created';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  submittedValues?: SubmittedValues;
}

export const signUpInitialState: SignUpState = { status: 'idle' };
