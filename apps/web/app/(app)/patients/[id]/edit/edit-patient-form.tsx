'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { PatientFormFields } from '../../_lib/patient-form-fields';
import { updatePatient } from './actions';
import { editPatientInitialState, type SubmittedValues } from './types';

/**
 * Issue #747: reuses `PatientFormFields`, the same component/validation
 * `patients/new/page.tsx` uses, pre-filled with the patient's current
 * values rather than blank.
 */
export function EditPatientForm({
  patientId,
  initialValues,
}: {
  patientId: string;
  initialValues: SubmittedValues;
}) {
  const [state, formAction, pending] = useActionState(
    updatePatient,
    editPatientInitialState,
  );
  const values = state.submittedValues ?? initialValues;

  if (state.status === 'saved') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Changes saved</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/patients/${patientId}`}>Back to patient</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Edit patient</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="patientId" value={patientId} />
          <PatientFormFields values={values} fieldErrors={state.fieldErrors} />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/patients/${patientId}`}>Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
