'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ASSIGNABLE_STAFF_ROLES, type AssignableStaffRole, type UserSummary } from '@lis/domain';
import { Badge, Button, DataTable } from '@lis/ui';
import { changeUserRole, setUserEnabled } from './actions';

const ROLE_LABELS: Record<AssignableStaffRole, string> = {
  reception: 'Reception',
  technologist: 'Technologist',
  pathologist: 'Pathologist',
  qa: 'QA / lab manager',
  cashier: 'Cashier',
  lab_admin: 'Lab admin',
};

function isAssignableRole(role: string): role is AssignableStaffRole {
  return (ASSIGNABLE_STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Issue #703 (EPIC #697). Thin client wrapper around `DataTable`, same
 * Server→Client function-prop reasoning as
 * `referring-facilities-table.tsx`'s own header comment -- plus, unlike
 * that table, this one owns two real inline mutations (role change,
 * enable/disable) directly in its cells, mirroring `ThemeToggle`/
 * `LocaleSelect`'s own `useTransition` + `router.refresh()` shape (the
 * simplest existing pattern in this codebase for "a small control mutates
 * server state and the page should reflect it immediately").
 */
export function UsersTable({ rows }: { rows: UserSummary[] }) {
  return (
    <DataTable
      columns={[
        {
          id: 'name',
          header: 'Name',
          cell: (row) => `${row.firstName} ${row.lastName}`,
          sortable: true,
        },
        { id: 'email', header: 'Email', cell: (row) => row.email },
        {
          id: 'role',
          header: 'Role',
          cell: (row) => <RoleCell user={row} />,
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge variant={row.enabled ? 'default' : 'outline'}>
              {row.enabled ? 'Active' : 'Deactivated'}
            </Badge>
          ),
        },
        {
          id: 'actions',
          header: '',
          cell: (row) => <EnabledToggle user={row} />,
        },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="No staff accounts yet — add one below."
    />
  );
}

function RoleCell({ user }: { user: UserSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const currentRole = user.roles.find(isAssignableRole) ?? '';

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={`Role for ${user.email}`}
        defaultValue={currentRole}
        disabled={pending}
        onChange={(e) => {
          const role = e.target.value;
          if (!isAssignableRole(role)) return;
          setError(undefined);
          startTransition(async () => {
            const result = await changeUserRole(user.id, role);
            if (result.status === 'error') {
              setError(result.formError);
              return;
            }
            router.refresh();
          });
        }}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {!currentRole ? (
          <option value="" disabled>
            No assignable role
          </option>
        ) : null}
        {ASSIGNABLE_STAFF_ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function EnabledToggle({ user }: { user: UserSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setUserEnabled(user.id, !user.enabled);
          router.refresh();
        })
      }
    >
      {pending ? '…' : user.enabled ? 'Deactivate' : 'Activate'}
    </Button>
  );
}
