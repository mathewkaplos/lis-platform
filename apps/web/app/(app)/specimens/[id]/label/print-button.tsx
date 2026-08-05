'use client';

import { useState, useTransition } from 'react';
import { Button } from '@lis/ui';
import { printSpecimenLabel } from './actions';

/**
 * TASK-046 (FEAT-013 revision §2/§5/§10 Q1). Records the audited print
 * (`POST /v1/specimens/:id/print`) first, then triggers the browser's
 * native print dialog only on success -- `cancel-order-button.tsx`'s own
 * useTransition shape, not a form. `window.print()` is the entire "print
 * pipeline" this task builds (revision §5): no PDF, no printer-SDK/ZPL
 * integration exists anywhere in this repo, and none is available to build
 * or test against in this sandbox.
 */
export function PrintButton({ specimenId }: { specimenId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await printSpecimenLabel(specimenId);
      if (result.status === 'error') {
        setError(result.formError ?? 'Something went wrong printing this label.');
        return;
      }
      window.print();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 print:hidden">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button onClick={handleClick} disabled={isPending}>
        {isPending ? 'Printing…' : 'Print'}
      </Button>
    </div>
  );
}
