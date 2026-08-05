'use client';

import { useActionState, useState } from 'react';
import { specimenRejectionReasonSchema } from '@lis/domain';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { receiveSpecimen } from './actions';
import { receptionInitialState } from './types';

interface OrderedTestSummary {
  id: string;
  testDefinitionId: string;
  displayName: string;
}

interface OrderSummary {
  id: string;
  patient?: { firstName: string; lastName: string; mrn: string };
  eligibleOrderedTests: OrderedTestSummary[];
}

/** The exact seven CHECK-constrained values (`ck_specimen_rejection_reason`)
 * — rendered from the same Zod schema the server validates against, never a
 * separately hand-typed list (`domain/specimen-lifecycle` Skill entry #5). */
const REJECTION_REASONS = specimenRejectionReasonSchema.options;

/**
 * TASK-047 (FEAT-013 revision §2/§5). `specimenType` is a free-text input,
 * not a fixed dropdown — `specimen.specimen_type` has no CHECK constraint
 * and no catalog-driven vocabulary exists yet (revision §5,
 * `domain/specimen-lifecycle` Skill entry #4). Every ordered test defaults
 * checked (server's own default when `orderedTestIds` is omitted); this
 * form still sends the explicit list rather than omitting the field, so
 * what's submitted always matches what's visibly checked.
 */
export function ReceptionForm({ order }: { order: OrderSummary }) {
  const [state, formAction, pending] = useActionState(receiveSpecimen, receptionInitialState);
  const [intent, setIntent] = useState<'accept' | 'reject'>('accept');

  if (state.status === 'received') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>
            {state.createdStatus === 'rejected' ? 'Specimen rejected' : 'Specimen received'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-text-secondary">
            Accession number{' '}
            <span className="font-mono text-foreground">{state.createdAccessionNumber}</span>
          </p>
          {state.createdStatus === 'rejected' ? (
            <p className="text-text-secondary">
              Reason: <span className="text-foreground">{state.createdRejectionReason}</span>
            </p>
          ) : null}
          {state.createdSpecimenId ? (
            // A plain <a>, not next/link's <Link> -- forces a full page
            // navigation rather than client-side routing. This page's own
            // reception form fetched the order's patient name/MRN into its
            // RSC payload; Next's client-side nav leaves that payload's
            // inline <script> content in the DOM even after navigating
            // away (a real finding: `document.body.textContent` on the
            // label page still contained it). The printed/rendered label
            // itself was already PHI-free (revision §5/§10 Q3), but a hard
            // navigation here means the label page's own document never
            // carries the prior page's patient data at all.
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={`/specimens/${state.createdSpecimenId}/label`}>Print label</a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          {order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : 'Reception'}
        </CardTitle>
        {order.patient ? (
          <p className="text-sm text-text-secondary">
            MRN <span className="font-mono text-foreground">{order.patient.mrn}</span>
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="orderId" value={order.id} />

          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">Tests fulfilled</h3>
            <ul className="flex flex-col gap-2">
              {order.eligibleOrderedTests.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`test-${t.id}`}
                    name="orderedTestIds"
                    value={t.id}
                    defaultChecked
                    className="size-4 rounded border-input"
                  />
                  <label htmlFor={`test-${t.id}`} className="flex-1 cursor-pointer text-sm">
                    {t.displayName}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <FormField id="specimenType" label="Specimen type" required>
            <Input
              name="specimenType"
              placeholder="e.g. whole_blood, serum, urine"
              required
            />
          </FormField>

          {intent === 'reject' ? (
            <FormField id="rejectionReason" label="Rejection reason" required>
              <select
                name="rejectionReason"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="" disabled>
                  Select…
                </option>
                {REJECTION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="submit"
              name="intent"
              value="accept"
              onClick={() => setIntent('accept')}
              disabled={pending}
            >
              {pending && intent === 'accept' ? 'Receiving…' : 'Accept & receive'}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="reject"
              variant="destructive"
              onClick={(e) => {
                if (intent !== 'reject') {
                  // First click switches the form into reject mode (reveals
                  // the required reason select) without submitting yet —
                  // matches patients/new's own two-step confirm pattern.
                  e.preventDefault();
                  setIntent('reject');
                }
              }}
              disabled={pending}
            >
              {intent === 'reject' ? (pending ? 'Rejecting…' : 'Confirm rejection') : 'Reject'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export type { OrderSummary, OrderedTestSummary };
