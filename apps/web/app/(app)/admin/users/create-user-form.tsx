'use client';

import { useActionState } from 'react';
import { ASSIGNABLE_STAFF_ROLES } from '@lis/domain';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { createUser } from './actions';
import { createUserInitialState } from './types';

const ROLE_LABELS: Record<(typeof ASSIGNABLE_STAFF_ROLES)[number], string> = {
  reception: 'Reception',
  technologist: 'Technologist',
  pathologist: 'Pathologist',
  qa: 'QA / lab manager',
  cashier: 'Cashier',
  lab_admin: 'Lab admin',
};

/**
 * Issue #703 (EPIC #697). Mirrors
 * `admin/referring-facilities/create-referring-facility-form.tsx`'s own
 * `useActionState` + `FormField` create-form shape.
 */
export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, createUserInitialState);

  if (state.status === 'created' && state.createdUser) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>User added</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            <span className="text-foreground">
              {state.createdUser.firstName} {state.createdUser.lastName}
            </span>{' '}
            ({state.createdUser.email}) can now sign in with the role you assigned.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Add a staff account</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="firstName"
              label="First name"
              required
              errorText={state.fieldErrors?.firstName?.[0]}
            >
              <Input name="firstName" required />
            </FormField>
            <FormField
              id="lastName"
              label="Last name"
              required
              errorText={state.fieldErrors?.lastName?.[0]}
            >
              <Input name="lastName" required />
            </FormField>
          </div>
          <FormField id="email" label="Email" required errorText={state.fieldErrors?.email?.[0]}>
            <Input type="email" name="email" required />
          </FormField>
          <FormField
            id="password"
            label="Temporary password"
            required
            errorText={state.fieldErrors?.password?.[0]}
          >
            <Input type="password" name="password" required minLength={8} />
          </FormField>
          <FormField id="role" label="Role" required errorText={state.fieldErrors?.role?.[0]}>
            <select
              id="role"
              name="role"
              defaultValue=""
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select a role
              </option>
              {ASSIGNABLE_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add user'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
