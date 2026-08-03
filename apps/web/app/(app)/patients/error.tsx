'use client';

import { Button } from '@lis/ui';

// TASK-041: Next.js error boundaries must be Client Components. Catches a
// failed search API call (see page.tsx) and shows a real error state
// instead of an unhandled exception.
export default function PatientsError({
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
        {error.message || 'Something went wrong loading patients.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
