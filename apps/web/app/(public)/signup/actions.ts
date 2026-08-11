'use server';

import { signUpSchema } from '@lis/domain';
import type { SignUpState, SubmittedValues } from './types';

function rawFormValues(formData: FormData) {
  return {
    orgName: formData.get('orgName') || undefined,
    adminFirstName: formData.get('adminFirstName') || undefined,
    adminLastName: formData.get('adminLastName') || undefined,
    adminEmail: formData.get('adminEmail') || undefined,
    adminPassword: formData.get('adminPassword') || undefined,
  };
}

function submittedValuesOf(formData: FormData): SubmittedValues {
  return {
    orgName: String(formData.get('orgName') ?? ''),
    adminFirstName: String(formData.get('adminFirstName') ?? ''),
    adminLastName: String(formData.get('adminLastName') ?? ''),
    adminEmail: String(formData.get('adminEmail') ?? ''),
  };
}

/**
 * FEAT-049: the one Server Action in this app that does NOT call
 * `getValidAccessToken()` first — there is no session yet, by design (the
 * whole point of this route). Calls `apps/api`'s public `/onboarding/signup`
 * directly via `fetch`, not `createLisApiClient` (that wrapper requires an
 * access token; this is the one deliberately unauthenticated call site).
 */
export async function signUp(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const submittedValues = submittedValuesOf(formData);
  const parsed = signUpSchema.safeParse(rawFormValues(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.flatten().fieldErrors,
      submittedValues,
    };
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const response = await fetch(`${apiBaseUrl}/onboarding/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });

  if (!response.ok) {
    if (response.status === 409) {
      return {
        status: 'error',
        formError: 'An account with this email already exists.',
        submittedValues,
      };
    }
    return {
      status: 'error',
      formError: 'Something went wrong setting up your account. Please try again.',
      submittedValues,
    };
  }

  return { status: 'created' };
}
