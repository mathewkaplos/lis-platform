'use client';

import { useActionState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { createReferringFacility } from './actions';
import { createReferringFacilityInitialState } from './types';

/**
 * FEAT-066 (docs/plans/feat-066-patient-contact-referring-facility.md,
 * ADR-0053). Mirrors `admin/tests/create-test-form.tsx`'s own
 * `useActionState` + `FormField` create-form shape.
 */
export function CreateReferringFacilityForm() {
  const [state, formAction, pending] = useActionState(
    createReferringFacility,
    createReferringFacilityInitialState,
  );

  if (state.status === 'created' && state.createdFacility) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Referring facility added</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            <span className="text-foreground">{state.createdFacility.name}</span> was added. It
            can now be selected on order entry and invoicing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New referring facility</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <FormField id="name" label="Name" required errorText={state.fieldErrors?.name?.[0]}>
            <Input name="name" required placeholder="e.g. Radiocare Diagnostics" />
          </FormField>
          <FormField id="phone" label="Phone" errorText={state.fieldErrors?.phone?.[0]}>
            <Input name="phone" />
          </FormField>
          <FormField id="email" label="Email" errorText={state.fieldErrors?.email?.[0]}>
            <Input type="email" name="email" />
          </FormField>
          <FormField id="address" label="Address" errorText={state.fieldErrors?.address?.[0]}>
            <Input name="address" />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save facility'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
