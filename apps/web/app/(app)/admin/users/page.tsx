import { getSession } from '@/auth/get-session';
import { hasLabAdminRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CreateUserForm } from './create-user-form';
import { UsersTable } from './users-table';

/**
 * Issue #703 (EPIC #697). The original pilot-readiness audit's #2 finding:
 * no UI anywhere to create/list/deactivate/role-assign a second staff
 * account. Mirrors `admin/referring-facilities/page.tsx`'s own
 * list + create-form shape -- gated by `hasLabAdminRole`, matching
 * `GET/POST/PATCH /v1/users`'s own `manage_users` capability gate
 * server-side (this is the UI-visibility convenience only; the API route
 * is the real enforcement point, same as every other gated screen in this
 * app).
 */
export default async function AdminUsersPage() {
  const session = await getSession();
  const canManage = hasLabAdminRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.GET('/v1/users');
  if (response.status === 403) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Users</h1>
        </div>
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view or manage staff accounts.
        </p>
      </div>
    );
  }
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading users. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Staff accounts for this organization. {data.items.length} account(s).
        </p>
      </div>
      <UsersTable rows={data.items} />
      {canManage ? (
        <CreateUserForm />
      ) : (
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to add users.
        </p>
      )}
    </div>
  );
}
