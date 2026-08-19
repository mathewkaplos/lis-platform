'use client';

import { useActionState } from 'react';
import { Button, FormField } from '@lis/ui';
import { amendCase } from './actions';
import { amendCaseInitialState } from './types';

/**
 * Issue #615. Same `useActionState` + `FormField` shape as
 * `upload-wsi-form.tsx` in this same directory. `@lis/ui` has no dedicated
 * `Textarea` primitive today -- `FormField`'s `children` contract accepts
 * any single element, so a plain `<textarea>` works.
 */
export function AmendCaseForm({ caseId }: { caseId: string }) {
  const [state, formAction, pending] = useActionState(amendCase, amendCaseInitialState);

  if (state.status === 'done') {
    return <p className="text-sm text-success">Amendment submitted.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <FormField id={`amend-reason-${caseId}`} label="Reason for amendment" required>
        <textarea
          name="reason"
          required
          rows={3}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </FormField>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? 'Submitting…' : 'Submit amendment'}
      </Button>
    </form>
  );
}
