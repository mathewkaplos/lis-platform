'use client';

import { Button } from '@lis/ui';

// TASK-044 pattern (see orders/[id]/error.tsx): Next.js error boundaries
// must be Client Components. Catches a failed case-lineage fetch (see
// page.tsx) -- including a 403 permission denial -- and shows a real
// in-app error state instead of an unhandled exception. Also covers the
// nested slide viewer route (cases/[caseId]/slides/[slideId]/viewer),
// which has no error.tsx of its own and inherits this boundary.
export default function CaseDetailError({
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
        {error.message || 'Something went wrong loading this case.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
