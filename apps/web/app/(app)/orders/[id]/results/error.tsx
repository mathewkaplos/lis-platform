'use client';

import { Button } from '@lis/ui';

// TASK-052: Next.js error boundaries must be Client Components -- same
// pattern as orders/[id]/error.tsx. Catches a failed order/catalog/results
// fetch; a genuine 404 is handled separately via notFound() in page.tsx.
export default function ResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-danger">{error.message || 'Something went wrong loading results.'}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
