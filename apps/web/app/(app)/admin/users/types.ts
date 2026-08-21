import type { UserSummary } from '@lis/domain';

export interface CreateUserState {
  status: 'idle' | 'error' | 'created';
  formError?: string;
  fieldErrors?: Partial<Record<'firstName' | 'lastName' | 'email' | 'password' | 'role', string[]>>;
  createdUser?: UserSummary;
}

export const createUserInitialState: CreateUserState = { status: 'idle' };

export interface RowActionState {
  status: 'idle' | 'error';
  formError?: string;
}

export const rowActionInitialState: RowActionState = { status: 'idle' };
