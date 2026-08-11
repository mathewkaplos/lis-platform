'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, DataTable } from '@lis/ui';

export interface OrderRow {
  id: string;
  status: string;
  priority: string;
  createdAt: string;
  patient?: { firstName: string; lastName: string; mrn: string };
  orderedTests: { testDefinitionId: string }[];
}

const STATUS_VARIANT: Record<string, 'outline' | 'secondary'> = {
  ordered: 'outline',
  cancelled: 'secondary',
};

const PRIORITY_VARIANT: Record<string, 'outline' | 'destructive'> = {
  routine: 'outline',
  stat: 'destructive',
};

/**
 * TASK-044 (FEAT-012 proposal §2/§3): thin client island around the shared
 * `DataTable` primitive, mirroring `patients-table.tsx` exactly -- exists
 * only to own row-click navigation. `Badge`, not `StatusPill`
 * (`frontend-design` entry #1 reserves `StatusPill` for clinical result
 * flags, not general resource status).
 */
export function OrdersTable({
  rows,
  testNameById,
}: {
  rows: OrderRow[];
  testNameById: Map<string, string>;
}) {
  const router = useRouter();
  const t = useTranslations('Orders');
  // FEAT-048 (ADR-0043): the AC's own date-formatting proof point --
  // replaces the previous ad hoc `new Date(...).toLocaleString()` with a
  // locale-aware formatter driven by the same cookie every other screen
  // reads.
  const format = useFormatter();

  return (
    <DataTable
      columns={[
        {
          id: 'patient',
          header: t('columnPatient'),
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
          id: 'tests',
          header: t('columnTests'),
          cell: (row) => {
            const names = row.orderedTests.map(
              (test) => testNameById.get(test.testDefinitionId) ?? test.testDefinitionId,
            );
            const shown = names.slice(0, 2);
            const overflow = names.length - shown.length;
            return (
              <span className="text-sm">
                {shown.join(', ')}
                {overflow > 0 ? ` ${t('moreTests', { count: overflow })}` : ''}
              </span>
            );
          },
        },
        {
          id: 'priority',
          header: t('columnPriority'),
          cell: (row) => (
            <Badge variant={PRIORITY_VARIANT[row.priority] ?? 'outline'}>{row.priority}</Badge>
          ),
        },
        {
          id: 'status',
          header: t('columnStatus'),
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
          ),
        },
        {
          id: 'createdAt',
          header: t('columnCreatedAt'),
          cell: (row) =>
            format.dateTime(new Date(row.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          sortable: true,
          sortValue: (row) => row.createdAt,
        },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/orders/${row.id}`)}
      emptyMessage={t('emptyMessage')}
    />
  );
}
