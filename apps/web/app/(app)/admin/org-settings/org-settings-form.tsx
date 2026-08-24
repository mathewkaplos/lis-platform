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
 *
 * Pilot-readiness audit follow-up: the "Report email (Gmail)" section
 * below. `smtpAppPassword`'s own `<Input>` is never prefilled (the server
 * never returns the plaintext, encrypted or otherwise -- `settings` only
 * ever carries `smtpConfigured`, a boolean) -- a blank submission leaves
 * whatever's already saved untouched; the "Remove the saved app password"
 * checkbox (only rendered once one exists) is the one explicit way to
 * clear it, matching a real password-change form's own "type a new one,
 * or check a box to remove it, blank alone does nothing" convention.
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

          <div className="mt-2 flex flex-col gap-4 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Report email (Gmail)</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Signed case reports send from this account instead of the platform default,
                once configured. Requires a Gmail app password, not the account&apos;s real
                password — mint one at{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  myaccount.google.com/apppasswords
                </a>{' '}
                (needs 2-Step Verification already on).
              </p>
            </div>
            <FormField id="smtpUser" label="Gmail address">
              <Input
                type="email"
                name="smtpUser"
                placeholder="lab@example.com"
                defaultValue={values?.smtpUser ?? settings.smtpUser ?? ''}
              />
            </FormField>
            <FormField
              id="smtpAppPassword"
              label="App password"
              helperText={
                settings.smtpConfigured
                  ? 'An app password is already saved. Leave blank to keep it, or enter a new one to replace it.'
                  : 'No app password saved yet.'
              }
            >
              <Input
                type="password"
                name="smtpAppPassword"
                placeholder={settings.smtpConfigured ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                autoComplete="new-password"
              />
            </FormField>
            {settings.smtpConfigured ? (
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" name="clearSmtpAppPassword" value="true" className="size-4" />
                Remove the saved app password
              </label>
            ) : null}
            <FormField id="smtpFrom" label="From address (optional)" helperText="Defaults to the Gmail address above.">
              <Input
                type="email"
                name="smtpFrom"
                placeholder="reports@example.com"
                defaultValue={values?.smtpFrom ?? settings.smtpFrom ?? ''}
              />
            </FormField>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
