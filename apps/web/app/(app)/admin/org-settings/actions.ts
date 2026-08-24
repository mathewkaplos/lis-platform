'use server';

import { orgSettingsUpdateSchema } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { OrgSettingsFormState, SubmittedOrgSettings } from './types';

function rawFormValues(formData: FormData) {
  return {
    name: formData.get('name') || undefined,
    address: formData.get('address') || null,
    phone: formData.get('phone') || null,
    email: formData.get('email') || null,
    logoUrl: formData.get('logoUrl') || null,
    currency: formData.get('currency') || null,
    preferredSynopticSourceStandard: formData.get('preferredSynopticSourceStandard') || null,
    smtpUser: formData.get('smtpUser') || null,
    smtpFrom: formData.get('smtpFrom') || null,
    // "clearSmtpAppPassword" (a checkbox) wins over whatever's in the text
    // field -- explicit removal, not just "field happened to be blank."
    // A blank field with the checkbox unchecked sends `undefined`
    // (omitted), matching this whole schema's own "omitted key = leave
    // unchanged" convention (org-settings.controller.ts's own header
    // comment) -- the one field on this form where "leave blank" and
    // "clear it" must be two different, deliberate actions, since a
    // once-set app password has no visible current value to compare
    // against.
    smtpAppPassword:
      formData.get('clearSmtpAppPassword') === 'true'
        ? null
        : formData.get('smtpAppPassword') || undefined,
  };
}

function submittedValuesOf(formData: FormData): SubmittedOrgSettings {
  return {
    name: String(formData.get('name') ?? ''),
    address: String(formData.get('address') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
    logoUrl: String(formData.get('logoUrl') ?? ''),
    currency: String(formData.get('currency') ?? ''),
    preferredSynopticSourceStandard: String(
      formData.get('preferredSynopticSourceStandard') ?? '',
    ),
    smtpUser: String(formData.get('smtpUser') ?? ''),
    smtpFrom: String(formData.get('smtpFrom') ?? ''),
  };
}

/**
 * Issue #706. Mirrors `patients/new/actions.ts`'s own single Server Action
 * shape -- `getValidAccessToken()` is only usable from a Server
 * Action/Route Handler context (ADR-0014 §3). Gated server-side by
 * `manage_org_settings` (`PUT /v1/org-settings`'s own `CapabilityGuard`) --
 * this action surfaces a 403 as a friendly message rather than a thrown
 * error, since a non-`qa` viewer can legitimately reach this page read-only
 * (matches `create-referring-facility-form.tsx`'s own precedent).
 */
export async function updateOrgSettings(
  _prevState: OrgSettingsFormState,
  formData: FormData,
): Promise<OrgSettingsFormState> {
  const submittedValues = submittedValuesOf(formData);
  const parsed = orgSettingsUpdateSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.flatten().fieldErrors,
      submittedValues,
    };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return {
      status: 'error',
      formError: 'Your session has expired — please log in again.',
      submittedValues,
    };
  }
  const client = createLisApiClient(accessToken);

  const { response } = await client.PUT('/v1/org-settings', {
    body: parsed.data,
  });
  if (!response.ok) {
    if (response.status === 403) {
      return {
        status: 'error',
        formError: 'You do not have permission to edit organization settings.',
        submittedValues,
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong saving organization settings. Please try again.',
      submittedValues,
    };
  }
  return { status: 'saved' };
}
