'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, FormField, Input } from '@lis/ui';
import { sendReportEmail } from './actions';
import { sendReportEmailInitialState } from './types';

/**
 * Pilot-readiness audit follow-up (email delivery, deliberately deferred at
 * #698, now built). One form per report version -- a lab may want to
 * re-send an older version to a different recipient, not just the latest.
 * Stays visible and usable after a successful send (never unmounts, never
 * replaced by a permanent "sent" screen) -- same transient-confirmation
 * pattern `narrative-form.tsx` already established for exactly this
 * "the control should still be usable a second time" reasoning.
 *
 * `defaultTo` prefills from the patient's own on-file email
 * (`page.tsx`'s own fetch) -- always editable, so staff can send to a
 * referring clinician or anyone else instead. Submitting with the field
 * cleared out entirely (not just left at its prefilled value) still works:
 * `sendReportEmail()`'s own header comment explains the server resolves
 * the patient's on-file email again in that case.
 */
export function SendReportEmailForm({
  caseId,
  versionId,
  defaultTo,
}: {
  caseId: string;
  versionId: string;
  defaultTo?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    sendReportEmail,
    sendReportEmailInitialState,
  );
  const [prevState, setPrevState] = useState(state);
  const [justSent, setJustSent] = useState<string | undefined>(undefined);

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
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="versionId" value={versionId} />
      <FormField id={`send-email-to-${versionId}`} label="Email to" className="flex-1">
        <Input
          type="email"
          name="to"
          placeholder="patient@example.com"
          defaultValue={defaultTo ?? ''}
        />
      </FormField>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Sending…' : 'Send by email'}
      </Button>
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
