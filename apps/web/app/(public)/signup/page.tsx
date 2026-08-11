'use client';

import { useActionState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { signUp } from './actions';
import { signUpInitialState } from './types';

/**
 * FEAT-049 (docs/plans/feat-049-self-service-onboarding.md): a single-page
 * signup form, not the full Stitch §2.7 multi-step wizard (approved
 * proposal §5/§10 Q1 — no branch/facility data model or discipline picker
 * exists yet to build the fuller wizard against). Mirrors `patients/new/
 * page.tsx`'s own single-file `useActionState` + `FormField` shape exactly.
 *
 * On success, links into the existing, unmodified login flow
 * (`/api/auth/login`) rather than minting a session directly — reuses the
 * already-proven OIDC round trip instead of a second, parallel one. A plain
 * `<a>` (not `next/link`), since this always triggers a full navigation
 * into a Route Handler's own redirect chain regardless.
 */
export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUp, signUpInitialState);
  const values = state.submittedValues;

  if (state.status === 'created') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Your lab is set up</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            Your account and starter test catalog are ready.
          </p>
          <Button asChild className="mt-4">
            <a href="/api/auth/login">Log in to continue</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Set up your lab</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <FormField
            id="orgName"
            label="Organization name"
            required
            errorText={state.fieldErrors?.orgName?.[0]}
          >
            <Input name="orgName" defaultValue={values?.orgName} required placeholder="e.g. Riverside Diagnostics" />
          </FormField>
          <FormField
            id="adminFirstName"
            label="Your first name"
            required
            errorText={state.fieldErrors?.adminFirstName?.[0]}
          >
            <Input name="adminFirstName" defaultValue={values?.adminFirstName} required />
          </FormField>
          <FormField
            id="adminLastName"
            label="Your last name"
            required
            errorText={state.fieldErrors?.adminLastName?.[0]}
          >
            <Input name="adminLastName" defaultValue={values?.adminLastName} required />
          </FormField>
          <FormField
            id="adminEmail"
            label="Email"
            required
            errorText={state.fieldErrors?.adminEmail?.[0]}
          >
            <Input type="email" name="adminEmail" defaultValue={values?.adminEmail} required />
          </FormField>
          <FormField
            id="adminPassword"
            label="Password"
            required
            errorText={state.fieldErrors?.adminPassword?.[0]}
          >
            <Input type="password" name="adminPassword" required minLength={8} />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? 'Setting up…' : 'Create my lab'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
