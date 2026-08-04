'use client';

import { Button } from '@lis/ui';

// TASK-044: Next.js error boundaries must be Client Components. Catches a
// failed order/catalog fetch (see page.tsx) -- a genuine 404 is handled
// separately via notFound(), not this boundary.
export default function OrderDetailError({
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
        {error.message || 'Something went wrong loading this order.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
