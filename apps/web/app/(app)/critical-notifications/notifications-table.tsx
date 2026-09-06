'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge, Button, DataTable, type DataTableColumn } from '@lis/ui';
import { acknowledgeCriticalNotification } from './actions';

export interface NotificationRow {
  id: string;
  status: 'pending' | 'acknowledged' | 'escalated';
  escalationLevel: number;
  createdAt: string;
  patientName: string | null;
  patientMrn: string | null;
  analyteDisplay: string | null;
  valueNum: number | null;
  unit: string | null;
  flags: string[];
  orderId: string | null;
}

/**
 * Issue #809. Same imperative Server-Action-via-`useTransition` shape as
 * `qc-violations/violations-table.tsx`'s own `handleResolve` -- acknowledging
 * a row removes it from view immediately (this screen only ever shows
 * pending/escalated rows, per the server page's own fetch) rather than
 * waiting for a full page reload.
 *
 * The read-back note is entered inline (a small textarea revealed under the
 * row's own Acknowledge button, not a separate dialog/page) -- matches this
 * app's existing "smallest control that does the job" convention
 * (`amend-case-form.tsx`'s own plain `<textarea>` inside `FormField`).
 */
export function NotificationsTable({
  canAcknowledge,
  initialRows,
}: {
  canAcknowledge: boolean;
  initialRows: NotificationRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [readBackById, setReadBackById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [errorsByRow, setErrorsByRow] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function handleAcknowledge(id: string) {
    const readBack = (readBackById[id] ?? '').trim();
    if (!readBack) {
      setErrorsByRow((prev) => ({ ...prev, [id]: 'Enter what was read back before acknowledging.' }));
      return;
    }
    setSubmittingId(id);
    setErrorsByRow((prev) => Object.fromEntries(Object.entries(prev).filter(([rowId]) => rowId !== id)));
    startTransition(async () => {
      const outcome = await acknowledgeCriticalNotification(id, readBack);
      if (outcome.status === 'error') {
        setErrorsByRow((prev) => ({ ...prev, [id]: outcome.error ?? 'Something went wrong.' }));
        setSubmittingId(null);
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== id));
      setSubmittingId(null);
      setExpandedId(null);
    });
  }

  const columns: DataTableColumn<NotificationRow>[] = [
    {
      id: 'patient',
      header: 'Patient',
      cell: (row) => (
        <div>
          <span className="font-medium text-foreground">{row.patientName ?? 'Unknown patient'}</span>
          {row.patientMrn ? (
            <p className="text-xs text-text-secondary">
              MRN <span className="font-mono">{row.patientMrn}</span>
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'analyte',
      header: 'Analyte',
      cell: (row) => row.analyteDisplay ?? 'Unknown analyte',
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-foreground">
            {row.valueNum ?? '—'} {row.unit ?? ''}
          </span>
          {row.flags.map((flag) => (
            <Badge key={flag} variant="destructive">
              {flag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={row.status === 'escalated' ? 'destructive' : 'secondary'}>
          {row.status === 'escalated' ? `Escalated (level ${row.escalationLevel})` : 'Pending'}
        </Badge>
      ),
    },
    {
      id: 'createdAt',
      header: 'Detected',
      cell: (row) => new Date(row.createdAt).toLocaleString(),
      sortable: true,
      sortValue: (row) => row.createdAt,
    },
    {
      id: 'order',
      header: '',
      cell: (row) =>
        row.orderId ? (
          <Link href={`/orders/${row.orderId}`} className="text-sm text-primary hover:underline">
            View order
          </Link>
        ) : null,
    },
    {
      id: 'acknowledge',
      header: '',
      align: 'right',
      cell: (row) => {
        if (!canAcknowledge) return null;
        if (expandedId !== row.id) {
          return (
            <Button size="sm" variant="outline" onClick={() => setExpandedId(row.id)}>
              Acknowledge
            </Button>
          );
        }
        return (
          <div className="flex w-64 flex-col items-end gap-1">
            <textarea
              autoFocus
              rows={2}
              placeholder="What was read back, and to whom?"
              value={readBackById[row.id] ?? ''}
              onChange={(e) => setReadBackById((prev) => ({ ...prev, [row.id]: e.target.value }))}
              className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={submittingId === row.id}
                onClick={() => handleAcknowledge(row.id)}
              >
                {submittingId === row.id ? 'Submitting…' : 'Confirm'}
              </Button>
            </div>
            {errorsByRow[row.id] ? (
              <span className="text-xs text-destructive">{errorsByRow[row.id]}</span>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="No pending or escalated critical notifications."
    />
  );
}
