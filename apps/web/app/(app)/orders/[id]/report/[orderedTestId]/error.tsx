'use client';

import { Button } from '@lis/ui';

// TASK-060: Next.js error boundaries must be Client Components -- same
// convention as orders/[id]/error.tsx. A genuine 404 (order or ordered test
// not found) is handled separately via notFound(), not this boundary.
export default function ReportViewerError({
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
        {error.message || 'Something went wrong loading this report.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
