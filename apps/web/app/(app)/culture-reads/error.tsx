'use client';

import { Button } from '@lis/ui';

// Issue #751: same TASK-044 pattern as cases/error.tsx/billing/invoices/error.tsx --
// Next.js error boundaries must be Client Components. Catches a failed
// culture-reads fetch (see page.tsx), including a 403 permission denial,
// and shows a real in-app error state instead of an unhandled exception.
export default function CultureReadsError({
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
        {error.message || 'Something went wrong loading cultures due for reading.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
