'use client';

import { Button } from '@lis/ui';

// TASK-044 pattern (see orders/[id]/error.tsx, billing/invoices/[invoiceId]/error.tsx):
// Next.js error boundaries must be Client Components. Catches a failed
// invoice-list fetch (see page.tsx), including a 403 permission denial, and
// shows a real in-app error state instead of an unhandled exception falling
// through to Next's default error screen.
export default function InvoicesListError({
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
        {error.message || 'Something went wrong loading invoices.'}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
