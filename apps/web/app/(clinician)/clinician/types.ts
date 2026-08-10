// Split out from actions.ts: a `'use server'` file may only export async
// functions at runtime (`(app)/orders/new/types.ts`'s own header comment
// explains the exact failure this avoids — a plain object export throws
// only when a real request hits it, invisible to typecheck/lint).

export interface AcknowledgeCriticalState {
  status: 'idle' | 'error' | 'acknowledged';
  formError?: string;
}

export const acknowledgeCriticalInitialState: AcknowledgeCriticalState = {
  status: 'idle',
};
