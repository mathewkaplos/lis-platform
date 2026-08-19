'use client';

import { useActionState } from 'react';
import { Button } from '@lis/ui';
import { addBlock } from './actions';
import { addBlockInitialState } from './types';

/**
 * Issue #627. Nested-in-tree form under a part's own block list, same
 * placement precedent as `upload-wsi-form.tsx`'s per-slide upload affordance
 * -- not a top-level page card like `sign-out-case-form.tsx`/
 * `screen-case-form.tsx`. `specimenId` is always the enclosing part's own
 * id, never a user-facing choice, so it's a hidden field.
 *
 * Unlike the single-shot page actions (Amend/Sign out/Screen), this form has
 * no "done" branch that replaces the control -- it stays usable for adding a
 * second block, and the new tree entry itself, after `revalidatePath`, is
 * the visible proof (proposal §5).
 */
export function AddBlockForm({ caseId, specimenId }: { caseId: string; specimenId: string }) {
  const [state, formAction, pending] = useActionState(addBlock, addBlockInitialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 pl-4">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="specimenId" value={specimenId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add block'}
      </Button>
    </form>
  );
}
