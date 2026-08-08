'use client';

import { Button } from '@lis/ui';

// Next.js error boundaries must be Client Components -- same pattern as
// orders/[id]/results/error.tsx. Catches a failed chart/catalog fetch or the
// 400 for a non-quantity control lot; a genuine 404 is handled separately
// via notFound() in page.tsx.
export default function ChartError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-danger">{error.message || 'Something went wrong loading this chart.'}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
