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

export interface AddBlockState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const addBlockInitialState: AddBlockState = {
  status: 'idle',
};

export interface AddSlideState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const addSlideInitialState: AddSlideState = {
  status: 'idle',
};

export interface AddOrderedTestState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const addOrderedTestInitialState: AddOrderedTestState = {
  status: 'idle',
};

export interface UpdateNarrativeState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const updateNarrativeInitialState: UpdateNarrativeState = {
  status: 'idle',
};

export interface ReturnToScreeningState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
}

export const returnToScreeningInitialState: ReturnToScreeningState = {
  status: 'idle',
};

export interface SendReportEmailState {
  status: 'idle' | 'submitting' | 'done' | 'error';
  formError?: string;
  sentTo?: string;
}

export const sendReportEmailInitialState: SendReportEmailState = {
  status: 'idle',
};
