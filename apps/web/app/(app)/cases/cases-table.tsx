'use client';

import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@lis/ui';

export interface CaseRow {
  id: string;
  accessionNumber: string;
  status: string;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'destructive'> = {
  accessioned: 'outline',
  in_process: 'outline',
  pending_review: 'secondary',
  signed_out: 'secondary',
  amended: 'secondary',
};

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). Thin client island around
 * the shared `DataTable` primitive -- exists only to own row-click
 * navigation, same reasoning `patients-table.tsx`'s own header comment
 * already establishes.
 */
export function CasesTable({ rows }: { rows: CaseRow[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={[
        {
          id: 'accessionNumber',
          header: 'Accession number',
          cell: (row) => <span className="font-mono">{row.accessionNumber}</span>,
          sortable: true,
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
          ),
        },
        {
          id: 'createdAt',
          header: 'Created',
          cell: (row) => new Date(row.createdAt).toLocaleString(),
          sortable: true,
        },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/cases/${row.id}`)}
      emptyMessage="No cases yet."
    />
  );
}
