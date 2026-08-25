// Same "use server" export constraint as patients/new/types.ts (Next.js only
// allows async-function exports from a "use server" file) — this state
// shape is a genuine runtime value, kept out of actions.ts for the same
// reason.

export interface SubmittedValues {
  firstName: string;
  middleName: string;
  lastName: string;
  sex: string;
  birthDate: string;
  nationalId: string;
  phone: string;
  email: string;
  address: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
}

export interface EditPatientState {
  status: 'idle' | 'error' | 'saved';
  fieldErrors?: Record<string, string[] | undefined>;
  formError?: string;
  submittedValues?: SubmittedValues;
}

export const editPatientInitialState: EditPatientState = {
  status: 'idle',
};
