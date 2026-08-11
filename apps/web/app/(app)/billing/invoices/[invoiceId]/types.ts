// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (`engineering/frontend-design` entry #8).

export interface PaymentState {
  status: 'idle' | 'succeeded' | 'error';
  formError?: string;
}

export const paymentInitialState: PaymentState = { status: 'idle' };
