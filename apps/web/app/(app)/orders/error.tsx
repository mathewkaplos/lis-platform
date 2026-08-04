'use client';

import { Button } from '@lis/ui';

// TASK-044: Next.js error boundaries must be Client Components. Catches a
// failed orders/catalog API call (see page.tsx) and shows a real error
// state instead of an unhandled exception.
export default function OrdersError({
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
        {error.message || 'Something went wrong loading orders.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
