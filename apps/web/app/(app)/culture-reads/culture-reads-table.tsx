'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, DataTable, type DataTableColumn } from '@lis/ui';
import { recordCultureRead } from './actions';

export interface CultureReadRow {
  id: string;
  orderedTestId: string;
  scheduledAt: string;
}

/**
 * FEAT-052 (ADR-0046). "Cultures due for reading" -- a live query over
 * `culture_read` rows already due, not a full worklist dashboard (proposal
 * §2's own deliberately minimal scope, same "no filters, no dashboard"
 * framing `qc-violations/violations-table.tsx` already established for its
 * own comparable list+action screen). Recording a row removes it from view
 * immediately, mirroring that same screen's own optimistic-remove pattern --
 * this page only ever shows currently-due, unrecorded reads.
 */
export function CultureReadsTable({ initialRows }: { initialRows: CultureReadRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [errorsByRow, setErrorsByRow] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function handleRecord(id: string, result: 'no_growth' | 'growth') {
    setRecordingId(id);
    setErrorsByRow((prev) => Object.fromEntries(Object.entries(prev).filter(([rowId]) => rowId !== id)));
    startTransition(async () => {
      const outcome = await recordCultureRead(id, result);
      if (outcome.status === 'error') {
        setErrorsByRow((prev) => ({ ...prev, [id]: outcome.error ?? 'Something went wrong.' }));
        setRecordingId(null);
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== id));
      setRecordingId(null);
    });
  }

  const columns: DataTableColumn<CultureReadRow>[] = [
    {
      id: 'orderedTest',
      header: 'Ordered test',
      cell: (row) => <span className="font-mono text-sm text-foreground">{row.orderedTestId}</span>,
    },
    {
      id: 'scheduledAt',
      header: 'Due since',
      cell: (row) => new Date(row.scheduledAt).toLocaleString(),
      sortable: true,
      sortValue: (row) => row.scheduledAt,
    },
    {
      id: 'status',
      header: '',
      cell: () => <Badge variant="destructive">Due</Badge>,
    },
    {
      id: 'record',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={recordingId === row.id}
              onClick={() => handleRecord(row.id, 'no_growth')}
            >
              {recordingId === row.id ? 'Recording…' : 'No growth'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={recordingId === row.id}
              onClick={() => handleRecord(row.id, 'growth')}
            >
              {recordingId === row.id ? 'Recording…' : 'Growth'}
            </Button>
          </div>
          {errorsByRow[row.id] ? <span className="text-xs text-destructive">{errorsByRow[row.id]}</span> : null}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="No cultures currently due for reading."
    />
  );
}
