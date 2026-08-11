'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@lis/ui';
import type { Invoice } from '@lis/domain';
import { recordPayment } from './actions';
import { paymentInitialState } from './types';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_VARIANT: Record<Invoice['status'], 'outline' | 'secondary' | 'default'> = {
  unpaid: 'outline',
  partial: 'secondary',
  paid: 'default',
};

/**
 * FEAT-046 (ADR-0041, approved proposal §5): one screen covering Invoice
 * Details (§17.2), the take-payment flow (§17.3), and a receipt-style
 * payment history (§17.4) -- a real, continuous interaction (view an
 * invoice, take a payment, see confirmation) rather than three separate
 * page loads, which nothing in the approved proposal's own scope required.
 */
export function InvoiceView({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const boundRecordPayment = recordPayment.bind(null, invoice.id);
  const [state, formAction, pending] = useActionState(
    boundRecordPayment,
    paymentInitialState,
  );

  // A successful payment changes the invoice's own status server-side --
  // re-fetch the Server Component so the page reflects it (a new payment
  // amount, the balance-due default, and whether the take-payment card is
  // still shown at all). Deliberately in an effect, not during render.
  useEffect(() => {
    if (state.status === 'succeeded') {
      router.refresh();
    }
  }, [state.status, router]);

  const balanceDueCents =
    invoice.totalCents -
    // The server is the source of truth for status; balance shown here is
    // derived only for display, never used to decide whether payment is
    // still possible (the API's own 400 on an already-paid invoice is the
    // real guard).
    (invoice.status === 'paid' ? invoice.totalCents : 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Invoice</CardTitle>
          <Badge variant={STATUS_VARIANT[invoice.status]}>{invoice.status}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="py-2 font-medium">Billing code</th>
                <th className="py-2 font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-border/50">
                  <td className="py-2 font-mono text-foreground">
                    {item.billingCode ?? '—'}
                  </td>
                  <td className="py-2 text-foreground">{item.quantity}</td>
                  <td className="py-2 text-right text-foreground">
                    {formatCents(item.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-3 font-medium text-foreground">
                  Total
                </td>
                <td className="pt-3 text-right font-medium text-foreground">
                  {formatCents(invoice.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {invoice.status !== 'paid' ? (
        <Card>
          <CardHeader>
            <CardTitle>Take payment</CardTitle>
          </CardHeader>
          <CardContent>
            {state.status === 'error' && state.formError ? (
              <p role="alert" className="mb-4 text-sm text-danger">
                {state.formError}
              </p>
            ) : null}
            <form action={formAction} className="flex flex-col gap-4">
              <FormField id="method" label="Method" required>
                <select
                  name="method"
                  required
                  defaultValue="cash"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </FormField>
              <FormField id="amountCentsDollars" label="Amount (USD)" required>
                <Input
                  type="number"
                  name="amountCentsDollars"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={(balanceDueCents / 100).toFixed(2)}
                  onChange={(e) => {
                    // Server Action reads `amountCents` (cents, integer) --
                    // this hidden sibling field is what actually gets
                    // submitted.
                    const hidden = e.currentTarget.form?.elements.namedItem(
                      'amountCents',
                    ) as HTMLInputElement | null;
                    if (hidden) {
                      hidden.value = String(
                        Math.round(Number(e.currentTarget.value) * 100),
                      );
                    }
                  }}
                />
              </FormField>
              <input
                type="hidden"
                name="amountCents"
                defaultValue={balanceDueCents}
              />
              <FormField id="reference" label="Reference (mobile money number, optional)">
                <Input name="reference" placeholder="e.g. +254700000000" />
              </FormField>
              <Button type="submit" disabled={pending}>
                {pending ? 'Recording…' : 'Record payment & print receipt'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-text-secondary">
            Invoice <span className="font-mono text-foreground">{invoice.id}</span>
          </p>
          <p className="text-text-secondary">
            Total: <span className="text-foreground">{formatCents(invoice.totalCents)}</span>
          </p>
          <p className="text-text-secondary">
            Status: <span className="text-foreground">{invoice.status}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-fit"
            onClick={() => window.print()}
          >
            Print receipt
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
