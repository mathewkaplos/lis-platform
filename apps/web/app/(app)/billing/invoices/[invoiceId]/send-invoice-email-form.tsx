'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, FormField, Input } from '@lis/ui';
import { sendInvoiceEmail } from './actions';
import { sendInvoiceEmailInitialState } from './types';

/**
 * Issue #711 (docs/plans/task-711-invoice-email-delivery.md) — adapted
 * directly from `cases/[caseId]/send-report-email-form.tsx`'s own proven
 * shape: stays visible and usable after a successful send (never unmounts,
 * never replaced by a permanent "sent" screen), same transient-confirmation
 * pattern.
 *
 * `defaultTo` prefills from the invoice's own patient's on-file email
 * (`page.tsx`'s fetch). `facilityEmail`, present only when the invoice is
 * facility-billed (`payerType === 'corporate'`) and that facility has an
 * email on file, adds a second quick-fill option. Neither is exclusive: the
 * field is a plain controlled `<input>`, always further editable.
 */
export function SendInvoiceEmailForm({
  invoiceId,
  defaultTo,
  facilityEmail,
}: {
  invoiceId: string;
  defaultTo?: string | null;
  facilityEmail?: string | null;
}) {
  const boundSendInvoiceEmail = sendInvoiceEmail.bind(null, invoiceId);
  const [state, formAction, pending] = useActionState(
    boundSendInvoiceEmail,
    sendInvoiceEmailInitialState,
  );
  const [prevState, setPrevState] = useState(state);
  const [justSent, setJustSent] = useState<string | undefined>(undefined);
  const [to, setTo] = useState(defaultTo ?? '');

  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'done') {
      setJustSent(state.sentTo);
    }
  }

  useEffect(() => {
    if (!justSent) return;
    const timeout = setTimeout(() => setJustSent(undefined), 5000);
    return () => clearTimeout(timeout);
  }, [justSent]);

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <FormField id={`send-invoice-email-to-${invoiceId}`} label="Email to" className="flex-1">
          <Input
            type="email"
            name="to"
            placeholder="patient@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </FormField>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Sending…' : 'Send by email'}
        </Button>
      </div>
      {defaultTo || facilityEmail ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          Send to:
          {defaultTo ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setTo(defaultTo)}
            >
              Patient ({defaultTo})
            </button>
          ) : null}
          {facilityEmail ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setTo(facilityEmail)}
            >
              Referring facility ({facilityEmail})
            </button>
          ) : null}
        </div>
      ) : null}
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-xs text-danger">
          {state.formError}
        </p>
      ) : null}
      {justSent ? (
        <p role="status" className="text-xs text-success">
          Sent to {justSent}.
        </p>
      ) : null}
    </form>
  );
}
