'use client';

import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@lis/ui';
import { formatMoneyCents } from '@/lib/format-currency';

export interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  patientId: string;
  patientName: string;
  status: string;
  payerType: string;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'destructive'> = {
  unpaid: 'destructive',
  partial: 'secondary',
  paid: 'outline',
};

/**
 * Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md). Thin client
 * island around the shared `DataTable` primitive -- exists only to own
 * row-click navigation, same reasoning `cases-table.tsx`'s own header
 * comment already establishes.
 */
export function InvoicesTable({
  rows,
  currency,
}: {
  rows: InvoiceRow[];
  currency: string | null;
}) {
  const router = useRouter();

  return (
    <DataTable
      columns={[
        {
          id: 'invoiceNumber',
          header: 'Invoice #',
          cell: (row) => (
            <span className="font-mono text-xs">{row.invoiceNumber ?? row.id}</span>
          ),
        },
        {
          id: 'patientId',
          header: 'Patient',
          cell: (row) => row.patientName,
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
          ),
        },
        {
          id: 'payerType',
          header: 'Payer',
          cell: (row) => <Badge variant="outline">{row.payerType}</Badge>,
        },
        {
          id: 'totalCents',
          header: 'Total',
          cell: (row) => formatMoneyCents(row.totalCents, currency),
          sortable: true,
        },
        {
          id: 'amountPaidCents',
          header: 'Paid',
          cell: (row) => formatMoneyCents(row.amountPaidCents, currency),
        },
        {
          id: 'balanceDueCents',
          header: 'Balance due',
          cell: (row) => formatMoneyCents(row.balanceDueCents, currency),
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
      onRowClick={(row) => router.push(`/billing/invoices/${row.id}`)}
      emptyMessage="No invoices yet."
    />
  );
}
