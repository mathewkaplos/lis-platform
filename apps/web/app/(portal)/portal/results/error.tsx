'use client';

import { Button } from '@lis/ui';

// Next.js error boundaries must be Client Components -- same pattern as
// control-lots/[id]/chart/error.tsx.
export default function PortalResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-danger">{error.message || 'Something went wrong loading your results.'}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
