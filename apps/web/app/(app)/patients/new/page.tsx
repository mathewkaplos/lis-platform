'use client';

import { useActionState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@lis/ui';
import { registerPatient } from './actions';
import { registerPatientInitialState } from './types';

/**
 * TASK-040 (FEAT-011): the registration screen. KB-02-minimal field set only
 * (firstName/middleName/lastName/sex/birthDate/nationalId) — matches what
 * TASK-039's own API accepts today; contact/insurance/emergency-contact
 * fields wait for a follow-up once the design partner's real requirements
 * are known (TASK-038 proposal §10 Q1).
 *
 * `sex` is a native `<select>` wrapped in `FormField`, not a new shared
 * `packages/ui` primitive (proposal §5) — a single three-option field for
 * one form doesn't warrant one yet.
 */
export default function NewPatientPage() {
  const [state, formAction, pending] = useActionState(
    registerPatient,
    registerPatientInitialState,
  );
  const values = state.submittedValues;

  if (state.status === 'created') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Patient registered</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            MRN <span className="font-mono text-foreground">{state.createdMrn}</span> was
            assigned.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Register patient</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'duplicate-found' && state.duplicateMatch ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="font-medium text-foreground">Possible match found — review</p>
            <p className="mt-1 text-text-secondary">
              An existing patient, MRN{' '}
              <span className="font-mono text-foreground">{state.duplicateMatch.mrn}</span> (
              {state.duplicateMatch.firstName} {state.duplicateMatch.lastName}
              {state.duplicateMatch.birthDate ? `, born ${state.duplicateMatch.birthDate}` : ''}
              ), matches this registration&apos;s name and date of birth.
            </p>
            {/* Resubmits the exact values the server just echoed back
                (`state.submittedValues`), plus confirmDuplicate=true, so the
                Server Action skips straight to create (proposal §5) — never
                read back out of the DOM, which would be ambiguous once a
                second copy of the same field names exists on the page. */}
            <form action={formAction} className="mt-3 flex gap-2">
              <input type="hidden" name="firstName" value={values?.firstName} />
              <input type="hidden" name="middleName" value={values?.middleName} />
              <input type="hidden" name="lastName" value={values?.lastName} />
              <input type="hidden" name="sex" value={values?.sex} />
              <input type="hidden" name="birthDate" value={values?.birthDate} />
              <input type="hidden" name="nationalId" value={values?.nationalId} />
              <input type="hidden" name="confirmDuplicate" value="true" />
              <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                Register anyway
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => location.reload()}>
                Cancel
              </Button>
            </form>
          </div>
        ) : null}

        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          <FormField
            id="firstName"
            label="First name"
            required
            errorText={state.fieldErrors?.firstName?.[0]}
          >
            <Input name="firstName" defaultValue={values?.firstName} required />
          </FormField>
          <FormField
            id="middleName"
            label="Middle name"
            errorText={state.fieldErrors?.middleName?.[0]}
          >
            <Input name="middleName" defaultValue={values?.middleName} />
          </FormField>
          <FormField
            id="lastName"
            label="Last name"
            required
            errorText={state.fieldErrors?.lastName?.[0]}
          >
            <Input name="lastName" defaultValue={values?.lastName} required />
          </FormField>
          <FormField id="sex" label="Sex" required errorText={state.fieldErrors?.sex?.[0]}>
            <select
              name="sex"
              required
              defaultValue={values?.sex ?? ''}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="U">Unknown</option>
            </select>
          </FormField>
          <FormField
            id="birthDate"
            label="Date of birth"
            errorText={state.fieldErrors?.birthDate?.[0]}
          >
            <Input type="date" name="birthDate" defaultValue={values?.birthDate} />
          </FormField>
          <FormField
            id="nationalId"
            label="National ID"
            errorText={state.fieldErrors?.nationalId?.[0]}
          >
            <Input name="nationalId" defaultValue={values?.nationalId} />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save & register'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
