'use client';

import { useActionState } from 'react';
import { Button } from '@lis/ui';
import { addSlide } from './actions';
import { addSlideInitialState } from './types';

/**
 * Issue #627. Same shape as `add-block-form.tsx`, nested under a block's own
 * slide list. `addSlide()` takes no request body -- `blockId` is only
 * needed to build the URL, `caseId` only for `revalidatePath` -- both as
 * hidden fields since the server action only receives `FormData`, not
 * component props directly.
 */
export function AddSlideForm({ caseId, blockId }: { caseId: string; blockId: string }) {
  const [state, formAction, pending] = useActionState(addSlide, addSlideInitialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="blockId" value={blockId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add slide'}
      </Button>
    </form>
  );
}
