'use client';

import { useActionState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import type { OrgSettings } from '@lis/domain';
import { updateOrgSettings } from './actions';
import { orgSettingsFormInitialState } from './types';

// A small, common-code starter list, not an exhaustive ISO 4217 set --
// `currency` itself is stored as free text (org-settings.ts's own header
// comment), so "Other" plus a free-text fallback covers anything not listed
// without requiring a schema change to add a currency later.
const COMMON_CURRENCIES = ['USD', 'KES', 'EUR', 'GBP', 'TZS', 'UGX', 'ZAR', 'NGN'];

/**
 * Issue #706. Mirrors `create-referring-facility-form.tsx`'s
 * `useActionState` shape. Covers the new organization profile fields
 * (name/address/phone/email/logo/currency) plus the pre-existing #692
 * `preferredSynopticSourceStandard` preference, which had no editing UI at
 * all before this feature -- confirmed via `grep` before building this.
 */
export function OrgSettingsForm({ settings }: { settings: OrgSettings }) {
  const [state, formAction, pending] = useActionState(
    updateOrgSettings,
    orgSettingsFormInitialState,
  );

  const values = state.status === 'error' ? state.submittedValues : undefined;
  const currentCurrency = values?.currency ?? settings.currency ?? '';

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Organization settings</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'saved' ? (
          <p role="status" className="mb-4 text-sm text-foreground">
            Saved.
          </p>
        ) : null}
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <FormField
            id="name"
            label="Organization name"
            required
            errorText={state.status === 'error' ? state.fieldErrors?.name?.[0] : undefined}
          >
            <Input name="name" defaultValue={values?.name ?? settings.name ?? ''} required />
          </FormField>
          <FormField id="address" label="Address">
            <Input name="address" defaultValue={values?.address ?? settings.address ?? ''} />
          </FormField>
          <FormField id="phone" label="Phone">
            <Input name="phone" defaultValue={values?.phone ?? settings.phone ?? ''} />
          </FormField>
          <FormField id="email" label="Email">
            <Input
              type="email"
              name="email"
              defaultValue={values?.email ?? settings.email ?? ''}
            />
          </FormField>
          <FormField id="logoUrl" label="Logo URL">
            <Input
              type="url"
              name="logoUrl"
              placeholder="https://…"
              defaultValue={values?.logoUrl ?? settings.logoUrl ?? ''}
            />
          </FormField>
          <FormField id="currency" label="Currency (ISO code)">
            <Input
              name="currency"
              list="currency-suggestions"
              placeholder="e.g. USD"
              defaultValue={currentCurrency}
              maxLength={8}
            />
          </FormField>
          <datalist id="currency-suggestions">
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <FormField id="preferredSynopticSourceStandard" label="Default synoptic reporting standard">
            <select
              name="preferredSynopticSourceStandard"
              defaultValue={
                values?.preferredSynopticSourceStandard ??
                settings.preferredSynopticSourceStandard ??
                ''
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">No preference — always ask</option>
              <option value="CAP">CAP</option>
              <option value="ICCR">ICCR</option>
            </select>
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
