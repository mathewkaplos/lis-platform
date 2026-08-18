'use client';

import { Button } from '@lis/ui';

// TASK-044 pattern (see orders/error.tsx): Next.js error boundaries must be
// Client Components. Catches a failed cases-list API call (see page.tsx),
// including a 403 permission denial, and shows a real error state instead
// of an unhandled exception.
export default function CasesError({
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
        {error.message || 'Something went wrong loading cases.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
