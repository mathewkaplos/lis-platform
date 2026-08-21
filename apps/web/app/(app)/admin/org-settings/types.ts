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
