'use client';

import { useActionState } from 'react';
import { Button } from '@lis/ui';
import { signOutCase } from './actions';
import { signOutCaseInitialState } from './types';

/**
 * Issue #621. Same `useActionState` shape as `amend-case-form.tsx` in this
 * same directory, simplified -- `finalize()` takes no request body, so
 * there's no field to collect, just a submit action.
 */
export function SignOutCaseForm({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(signOutCase, signOutCaseInitialState);

  if (state.status === 'done') {
    return <p className="text-sm text-success">Case signed out.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <p className="text-sm text-text-secondary">
        Signs the case&apos;s report content and moves it to signed out. Requires a fresh
        re-authentication.
      </p>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? 'Signing out…' : 'Sign out this case'}
      </Button>
    </form>
  );
}
