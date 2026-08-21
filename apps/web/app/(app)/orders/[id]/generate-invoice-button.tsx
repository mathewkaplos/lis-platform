'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lis/ui';
import { generateInvoice } from './actions';

/**
 * FEAT-046 (ADR-0041). Same plain-async-function-called-from-a-client-
 * button shape as `cancel-order-button.tsx`'s own precedent -- no form
 * data involved.
 */
export function GenerateInvoiceButton({
  orderId,
  referringFacilityId,
}: {
  orderId: string;
  referringFacilityId?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await generateInvoice(orderId, referringFacilityId);
      if (result.status === 'error' || !result.invoiceId) {
        setError(result.formError ?? 'Something went wrong generating this invoice.');
        return;
      }
      router.push(`/billing/invoices/${result.invoiceId}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? 'Generating…' : 'Generate invoice'}
      </Button>
    </div>
  );
}
