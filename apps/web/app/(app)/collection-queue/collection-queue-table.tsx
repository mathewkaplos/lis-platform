'use client';

import Link from 'next/link';
import { Badge, Button, DataTable } from '@lis/ui';

export interface CollectionQueueRow {
  id: string;
  priority: string;
  createdAt: string;
  patient?: { firstName: string; lastName: string; mrn: string };
  orderedTests: { testDefinitionId: string }[];
}

const PRIORITY_VARIANT: Record<string, 'outline' | 'destructive'> = {
  routine: 'outline',
  stat: 'destructive',
};

/**
 * TASK-048 (FEAT-013 revision §2/§3). `orders-table.tsx`'s own
 * `DataTable`/`Badge`/`PRIORITY_VARIANT` shape reused almost verbatim --
 * `Badge`, not `StatusPill` (`frontend-design` entry #1 reserves
 * `StatusPill` for clinical result flags). One new column `orders-table.tsx`
 * doesn't have: a "Receive" quick action, reusing `/reception?orderId=`,
 * the same no-scanner entry point `orders/[id]/page.tsx`'s own "Receive at
 * reception" link already established.
 *
 * "Tests pending collection" (not "required tubes") -- revision §1/§10,
 * human-resolved 2026-08-05: no specimen-type/container/tube catalog data
 * exists anywhere in this repo, so this column shows each pending test's
 * own catalog display name instead.
 */
export function CollectionQueueTable({
  rows,
  testNameById,
}: {
  rows: CollectionQueueRow[];
  testNameById: Map<string, string>;
}) {
  return (
    <DataTable
      columns={[
        {
          id: 'patient',
          header: 'Patient',
          cell: (row) =>
            row.patient ? (
              <span>
                {row.patient.firstName} {row.patient.lastName}{' '}
                <span className="font-mono text-xs text-text-secondary">{row.patient.mrn}</span>
              </span>
            ) : (
              '—'
            ),
        },
        {
          id: 'priority',
          header: 'Priority',
          cell: (row) => (
            <Badge variant={PRIORITY_VARIANT[row.priority] ?? 'outline'}>{row.priority}</Badge>
          ),
        },
        {
          id: 'tests',
          header: 'Tests pending collection',
          cell: (row) => {
            const names = row.orderedTests.map(
              (t) => testNameById.get(t.testDefinitionId) ?? t.testDefinitionId,
            );
            return <span className="text-sm">{names.join(', ')}</span>;
          },
        },
        {
          id: 'createdAt',
          header: 'Ordered at',
          cell: (row) => new Date(row.createdAt).toLocaleString(),
          sortable: true,
          sortValue: (row) => row.createdAt,
        },
        {
          id: 'actions',
          header: '',
          cell: (row) => (
            <Button asChild variant="outline" size="sm">
              <Link href={`/reception?orderId=${row.id}`}>Receive</Link>
            </Button>
          ),
        },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="Nothing pending collection."
    />
  );
}
