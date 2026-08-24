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
 * `defaultTo` prefills the field on first render from the patient's own
 * on-file email (`page.tsx`'s own fetch). `facilityEmail`, when the
 * order's own referring facility has one on file, adds a second quick-fill
 * option -- a referring clinician, not the patient, is often the intended
 * report recipient. Neither is exclusive: the field is a plain controlled
 * `<input>`, always further editable, and submitting with it cleared out
 * entirely still works (`sendReportEmail()`'s own header comment explains
 * the server resolves the patient's on-file email again in that case --
 * never the facility's, which has no server-side default of its own).
 */
export function SendReportEmailForm({
  caseId,
  versionId,
  defaultTo,
  facilityEmail,
}: {
  caseId: string;
  versionId: string;
  defaultTo?: string | null;
  facilityEmail?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    sendReportEmail,
    sendReportEmailInitialState,
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
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="versionId" value={versionId} />
      <div className="flex items-end gap-2">
        <FormField id={`send-email-to-${versionId}`} label="Email to" className="flex-1">
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
