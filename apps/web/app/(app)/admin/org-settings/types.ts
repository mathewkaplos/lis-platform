/**
 * Issue #706. Kept out of `actions.ts` (a `'use server'` file) --
 * `engineering/frontend-design` Skill entry #8: a `'use server'` file may
 * only export async functions at runtime; a plain object/type export throws
 * only when a real request hits it, never at typecheck/lint/build.
 */
export interface OrgSettingsFieldErrors {
  name?: string[];
}

export interface SubmittedOrgSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  currency: string;
  preferredSynopticSourceStandard: string;
  // Per-tenant email delivery follow-up: smtpUser/smtpFrom are plain email
  // addresses, safe to redisplay on a validation error like every other
  // field here. smtpAppPassword is deliberately NOT part of this type --
  // a submitted plaintext password is never persisted into redisplay
  // state, the same "never echo a secret back" discipline the server side
  // already applies (org-settings.controller.ts's own toOrgSettings never
  // returns it either).
  smtpUser: string;
  smtpFrom: string;
}

export type OrgSettingsFormState =
  | { status: 'idle' }
  | { status: 'saved' }
  | {
      status: 'error';
      formError?: string;
      fieldErrors?: OrgSettingsFieldErrors;
      submittedValues?: SubmittedOrgSettings;
    };

export const orgSettingsFormInitialState: OrgSettingsFormState = { status: 'idle' };
