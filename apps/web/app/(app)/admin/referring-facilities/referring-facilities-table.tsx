'use client';

import { DataTable } from '@lis/ui';
import type { ReferringFacility } from '@lis/domain';

/**
 * TASK-699 (EPIC #697). Thin client wrapper around `DataTable` — exists only
 * to own the `columns`/`getRowId` function values, which cannot cross the
 * Server→Client boundary when constructed inline in a Server Component (the
 * page's own previous shape threw "Functions cannot be passed directly to
 * Client Components" on every load). Mirrors `patients/patients-table.tsx`'s
 * identical fix for the identical problem — see `engineering/frontend-design`
 * Skill entry #6.
 */
export function ReferringFacilitiesTable({ rows }: { rows: ReferringFacility[] }) {
  return (
    <DataTable
      columns={[
        { id: 'name', header: 'Name', cell: (row) => row.name, sortable: true },
        { id: 'phone', header: 'Phone', cell: (row) => row.phone ?? '—' },
        { id: 'email', header: 'Email', cell: (row) => row.email ?? '—' },
        { id: 'address', header: 'Address', cell: (row) => row.address ?? '—' },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="No referring facilities yet — add one below."
    />
  );
}
