'use client';

import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@lis/ui';
import type { WorklistItem } from '@lis/domain';
import { formatDuration } from '@/lib/format-duration';

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'default'> = {
  ordered: 'outline',
  received: 'outline',
  in_process: 'default',
  resulted: 'secondary',
  cancelled: 'outline',
  rejected: 'outline',
};

const PRIORITY_VARIANT: Record<string, 'outline' | 'destructive'> = {
  routine: 'outline',
  stat: 'destructive',
};

/**
 * TASK-062 (FEAT-017 revision, §10 Q2, approved): row-click destination is
 * status-conditional, not one fixed target -- `ENTERABLE_ORDERED_TEST_STATUSES`
 * (apps/api/src/observation/observation.controller.ts) only accepts
 * 'received'/'in_process' for result entry, so a plain 'ordered' row (not
 * yet received) has no results screen to usefully land on yet.
 */
function destinationFor(item: WorklistItem): string {
  switch (item.status) {
    case 'received':
    case 'in_process':
      return `/orders/${item.orderId}/results`;
    case 'resulted':
      return `/orders/${item.orderId}/report/${item.id}`;
    default:
      return `/orders/${item.orderId}`;
  }
}

/**
 * TASK-062: thin client island around `DataTable`, mirroring
 * `orders-table.tsx`'s exact shape -- exists only to own status-conditional
 * row-click navigation (§10 Q2), the literal "two clicks or fewer" AC path
 * for a 'received'/'in_process' row.
 */
export function WorklistView({ items }: { items: WorklistItem[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={[
        {
          id: 'patient',
          header: 'Patient',
          cell: (row) => (
            <span>
              {row.patient.firstName} {row.patient.lastName}{' '}
              <span className="font-mono text-xs text-text-secondary">{row.patient.mrn}</span>
            </span>
          ),
        },
        {
          id: 'test',
          header: 'Test',
          cell: (row) => <span className="text-sm">{row.testDisplayName}</span>,
        },
        {
          id: 'priority',
          header: 'Priority',
          cell: (row) => (
            <Badge variant={PRIORITY_VARIANT[row.priority] ?? 'outline'}>{row.priority}</Badge>
          ),
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
          ),
        },
        {
          id: 'tat',
          header: 'TAT',
          cell: (row) => <span className="tabular-nums">{formatDuration(row.ageMinutes)}</span>,
          sortable: true,
          sortValue: (row) => row.ageMinutes,
        },
      ]}
      data={items}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(destinationFor(row))}
      emptyMessage="Nothing in this view."
    />
  );
}
