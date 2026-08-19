'use client';

import { useActionState } from 'react';
import { Button, FormField } from '@lis/ui';
import { returnToScreening } from './actions';
import { returnToScreeningInitialState } from './types';

/**
 * Issue #639. Blends two precedents: `amend-case-form.tsx`'s own required
 * `reason` textarea shape, and `sign-out-case-form.tsx`/`screen-case-form.tsx`'s
 * own no-permanent-"done"-branch shape -- a successful submission moves the
 * case out of `pending_review`, so this card's own status-conditional gate
 * on the page makes it disappear on the next render; unlike Amend (which
 * stays usable for a second amendment), there's no "still visible, still
 * usable" scenario to design for here.
 */
export function ReturnToScreeningForm({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(
    returnToScreening,
    returnToScreeningInitialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <FormField id={`return-reason-${caseId}`} label="Reason for returning to screening" required>
        <textarea
          name="reason"
          required
          rows={3}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </FormField>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-fit">
        {pending ? 'Returning…' : 'Return to screening'}
      </Button>
    </form>
  );
}
