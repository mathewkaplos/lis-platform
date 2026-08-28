'use server';

import { revalidatePath } from 'next/cache';
import { createUserSchema, type AssignableStaffRole, type UserSummary } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import type { CreateUserState, RowActionState } from './types';

/**
 * Issue #703 (EPIC #697). Mirrors `admin/referring-facilities/actions.ts`'s
 * own create-form shape.
 */
export async function createUser(
  _prevState: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const parsed = createUserSchema.safeParse({
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
    email: formData.get('email') || undefined,
    password: formData.get('password') || undefined,
    role: formData.get('role') || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let data, response;
  try {
    ({ data, response } = await client.POST('/v1/users', { body: parsed.data }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server — your data was not saved, please try again.',
    };
  }
  if (!response.ok) {
    if (response.status === 409) {
      return { status: 'error', formError: 'A user with this email already exists.' };
    }
    if (response.status === 403) {
      return { status: 'error', formError: 'You do not have permission to add users.' };
    }
    return {
      status: 'error',
      formError: 'Something went wrong creating this user. Please try again.',
    };
  }
  // Same untyped-audited-route cast `admin/referring-facilities/actions.ts`'s
  // own `createReferringFacility()` uses -- `engineering/api-design` Skill
  // entry #15.
  const created = data as unknown as { after: UserSummary };
  revalidatePath('/admin/users');
  return { status: 'created', createdUser: created.after };
}

export async function changeUserRole(
  userId: string,
  role: AssignableStaffRole,
): Promise<RowActionState> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let response;
  try {
    ({ response } = await client.PATCH('/v1/users/{id}/role', {
      params: { path: { id: userId } },
      body: { role },
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server. Please try again.',
    };
  }
  if (!response.ok) {
    return {
      status: 'error',
      formError:
        response.status === 403
          ? 'You do not have permission to change roles.'
          : 'Something went wrong changing this role. Please try again.',
    };
  }
  revalidatePath('/admin/users');
  return { status: 'idle' };
}

export async function setUserEnabled(
  userId: string,
  enabled: boolean,
): Promise<RowActionState> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', formError: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  let response;
  try {
    ({ response } = await client.PATCH('/v1/users/{id}/enabled', {
      params: { path: { id: userId } },
      body: { enabled },
    }));
  } catch {
    return {
      status: 'error',
      formError: 'Something went wrong reaching the server. Please try again.',
    };
  }
  if (!response.ok) {
    return {
      status: 'error',
      formError:
        response.status === 403
          ? 'You do not have permission to activate/deactivate users.'
          : 'Something went wrong. Please try again.',
    };
  }
  revalidatePath('/admin/users');
  return { status: 'idle' };
}
