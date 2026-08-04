'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lis/ui';
import { cancelOrder } from './actions';

/**
 * TASK-044 (FEAT-012 proposal §5). Native `confirm()` -- no new primitive
 * needed for a single yes/no confirmation. Only rendered by the detail page
 * when `order.status === 'ordered'`; a `409` from a genuine race (order
 * cancelled in another tab) surfaces as a real error message, not silently
 * swallowed.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm('Cancel this order? This cannot be undone.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await cancelOrder(orderId);
      if (result.status === 'error') {
        setError(result.formError ?? 'Something went wrong cancelling this order.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button variant="destructive" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? 'Cancelling…' : 'Cancel order'}
      </Button>
    </div>
  );
}
