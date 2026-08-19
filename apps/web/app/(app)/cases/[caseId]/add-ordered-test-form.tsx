'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Catalog } from '@lis/domain';
import { Button } from '@lis/ui';
import { addOrderedTest } from './actions';
import { addOrderedTestInitialState } from './types';

/**
 * Issue #630. Same nested-in-tree, always-rendered shape as `add-slide-form.tsx`,
 * plus one real field: a plain `<select>` over the catalog, not the full
 * `order-builder-form.tsx` multi-select/panel UI -- this route only ever
 * accepts one `testDefinitionId` per call.
 *
 * No new tree node exists as visible proof of success (unlike a block/slide),
 * so a transient local `justAdded` flag drives a brief confirmation instead
 * of a permanent "done" branch. Deliberately does NOT re-invoke `formAction`
 * to reset state -- that issues a second, real, malformed network request
 * (a mistake made and caught during this same session's #627 work).
 */
export function AddOrderedTestForm({
  caseId,
  blockId,
  tests,
}: {
  caseId: string;
  blockId: string;
  tests: Catalog['tests'];
}) {
  const [state, formAction, pending] = useActionState(addOrderedTest, addOrderedTestInitialState);
  const [prevState, setPrevState] = useState(state);
  const [justAdded, setJustAdded] = useState(false);

  // React's own "adjusting state during render" pattern (not an effect) --
  // fires exactly once per successful submit, since `state` is a fresh
  // object per `useActionState` dispatch.
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'done') {
      setJustAdded(true);
    }
  }

  // The timed reset is a genuine side effect (an external timer), so it
  // belongs in an effect -- but the effect itself only calls `setState`
  // inside the `setTimeout` callback, not synchronously in the effect body,
  // so it isn't the same "setState-in-effect" pattern flagged above.
  useEffect(() => {
    if (!justAdded) return;
    const timeout = setTimeout(() => setJustAdded(false), 3000);
    return () => clearTimeout(timeout);
  }, [justAdded]);

  if (tests.length === 0) {
    return null;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="blockId" value={blockId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      {justAdded ? <p className="text-sm text-success">Test added.</p> : null}
      <div className="flex items-center gap-2">
        <select
          name="testDefinitionId"
          required
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {tests.map((test) => (
            <option key={test.id} value={test.id}>
              {test.displayName} ({test.code})
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending} className="w-fit">
          {pending ? 'Adding…' : 'Add test'}
        </Button>
      </div>
    </form>
  );
}
