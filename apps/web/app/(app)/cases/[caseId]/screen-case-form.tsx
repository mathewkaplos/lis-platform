'use client';

import { useActionState } from 'react';
import { Button } from '@lis/ui';
import { screenCase } from './actions';
import { screenCaseInitialState } from './types';

/**
 * Issue #624. Same `useActionState` shape as `sign-out-case-form.tsx` in
 * this same directory -- `screen()` takes no request body, so there's no
 * field to collect, just a submit action.
 */
export function ScreenCaseForm({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(screenCase, screenCaseInitialState);

  if (state.status === 'done') {
    return <p className="text-sm text-success">Case screened.</p>;
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
        Moves a cytology case requiring two-tier review to pending review, ahead of sign-out. Not
        needed for a histology case.
      </p>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? 'Screening…' : 'Screen this case'}
      </Button>
    </form>
  );
}
