'use client';

import { Button } from '@lis/ui';

// Issue #751: same TASK-044 pattern as cases/error.tsx/billing/invoices/error.tsx --
// Next.js error boundaries must be Client Components. Catches a failed
// facility-statement fetch (see page.tsx), including a 403 permission
// denial on the underlying invoices query, and shows a real in-app error
// state instead of an unhandled exception.
export default function FacilityStatementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-sm text-danger">
        {error.message || 'Something went wrong loading this statement.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
