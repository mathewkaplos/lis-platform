'use client';

import { useActionState, useEffect, useState } from 'react';
import type { CaseNarrative } from '@lis/domain';
import { Button, FormField } from '@lis/ui';
import { updateNarrative } from './actions';
import { updateNarrativeInitialState } from './types';

const TEXTAREA_CLASS =
  'rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Issue #636. Three `FormField`-wrapped `<textarea>`s, uncontrolled
 * (`defaultValue`, same convention `amend-case-form.tsx` already uses) --
 * unlike that form, this one stays visible and editable after a successful
 * save rather than being permanently replaced, since narrative can be
 * edited at any case status (proposal §5). Reuses `add-ordered-test-form.tsx`'s
 * own transient-confirmation pattern (issue #630) for exactly that reason.
 */
export function NarrativeForm({
  caseId,
  narrative,
}: {
  caseId: string;
  narrative: CaseNarrative | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateNarrative,
    updateNarrativeInitialState,
  );
  const [prevState, setPrevState] = useState(state);
  const [justSaved, setJustSaved] = useState(false);

  // React's own "adjusting state during render" pattern (not an effect) --
  // fires exactly once per successful submit, since `state` is a fresh
  // object per `useActionState` dispatch.
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'done') {
      setJustSaved(true);
    }
  }

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 3000);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="caseId" value={caseId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      {justSaved ? <p className="text-sm text-success">Narrative saved.</p> : null}
      <FormField id={`gross-description-${caseId}`} label="Gross description">
        <textarea
          name="grossDescription"
          rows={4}
          defaultValue={narrative?.grossDescription ?? ''}
          className={TEXTAREA_CLASS}
        />
      </FormField>
      <FormField id={`microscopic-description-${caseId}`} label="Microscopic description">
        <textarea
          name="microscopicDescription"
          rows={4}
          defaultValue={narrative?.microscopicDescription ?? ''}
          className={TEXTAREA_CLASS}
        />
      </FormField>
      <FormField id={`diagnosis-${caseId}`} label="Diagnosis">
        <textarea
          name="diagnosis"
          rows={4}
          defaultValue={narrative?.diagnosis ?? ''}
          className={TEXTAREA_CLASS}
        />
      </FormField>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save narrative'}
      </Button>
    </form>
  );
}
