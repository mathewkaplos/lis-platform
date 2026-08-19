// Split out from actions.ts -- same "'use server' file may only export
// async functions" constraint `patients/new/types.ts`'s own header comment
// already documents (frontend-design Skill entry #8).

export interface UploadWholeSlideImageState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  formError?: string;
  resultStatus?: 'ready' | 'failed';
  resultErrorMessage?: string | null;
}

export const uploadWholeSlideImageInitialState: UploadWholeSlideImageState = {
  status: 'idle',
};

export interface AmendCaseState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const amendCaseInitialState: AmendCaseState = {
  status: 'idle',
};

export interface SignOutCaseState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const signOutCaseInitialState: SignOutCaseState = {
  status: 'idle',
};

export interface ScreenCaseState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const screenCaseInitialState: ScreenCaseState = {
  status: 'idle',
};
