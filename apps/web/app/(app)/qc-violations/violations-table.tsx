'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge, Button, DataTable, type DataTableColumn } from '@lis/ui';
import { resolveQcRuleViolation } from './actions';

export interface ViolationRow {
  id: string;
  controlLotId: string;
  analyteId: string;
  analyteDisplay: string;
  ruleCode: string;
  severity: 'warning' | 'rejection';
  detectedAt: string;
}

const RULE_LABEL: Record<string, string> = {
  '1_2s': '1-2s',
  '1_3s': '1-3s',
  '2_2s': '2-2s',
  r_4s: 'R-4s',
  '4_1s': '4-1s',
  '10x': '10x',
};

/**
 * TASK-070 (FEAT-020, ADR-0019 Decision 3, proposal §10 Q2 folding in issue
 * #381). A minimal violation queue -- unresolved rejection-severity rows are
 * the ones actually holding a `finalize()` rollup (ADR-0019 Decision 1),
 * warning-only rows never gate but are still shown for visibility. Resolving
 * a row removes it from view immediately (this screen only ever shows
 * `?resolved=false`, the server page's own default) rather than waiting for
 * a full page reload, mirroring `results-grid.tsx`'s own
 * imperative-Server-Action-via-`useTransition` precedent.
 */
export function ViolationsTable({
  isQa,
  initialRows,
}: {
  isQa: boolean;
  initialRows: ViolationRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [errorsByRow, setErrorsByRow] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function handleResolve(id: string) {
    setResolvingId(id);
    setErrorsByRow((prev) => Object.fromEntries(Object.entries(prev).filter(([rowId]) => rowId !== id)));
    startTransition(async () => {
      const outcome = await resolveQcRuleViolation(id);
      if (outcome.status === 'error') {
        setErrorsByRow((prev) => ({ ...prev, [id]: outcome.error ?? 'Something went wrong.' }));
        setResolvingId(null);
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== id));
      setResolvingId(null);
    });
  }

  const columns: DataTableColumn<ViolationRow>[] = [
    {
      id: 'analyte',
      header: 'Analyte',
      cell: (row) => <span className="font-medium text-foreground">{row.analyteDisplay}</span>,
      sortable: true,
      sortValue: (row) => row.analyteDisplay,
    },
    {
      id: 'rule',
      header: 'Rule',
      cell: (row) => RULE_LABEL[row.ruleCode] ?? row.ruleCode,
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: (row) => (
        <Badge variant={row.severity === 'rejection' ? 'destructive' : 'secondary'}>
          {row.severity === 'rejection' ? 'Rejection' : 'Warning'}
        </Badge>
      ),
    },
    {
      id: 'detectedAt',
      header: 'Detected',
      cell: (row) => new Date(row.detectedAt).toLocaleString(),
      sortable: true,
      sortValue: (row) => row.detectedAt,
    },
    {
      id: 'lot',
      header: 'Control lot',
      cell: (row) => (
        <Link href={`/control-lots/${row.controlLotId}/chart`} className="text-primary hover:underline">
          View chart
        </Link>
      ),
    },
    {
      id: 'resolve',
      header: '',
      align: 'right',
      cell: (row) =>
        isQa ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={resolvingId === row.id}
              onClick={() => handleResolve(row.id)}
            >
              {resolvingId === row.id ? 'Resolving…' : 'Resolve'}
            </Button>
            {errorsByRow[row.id] ? (
              <span className="text-xs text-destructive">{errorsByRow[row.id]}</span>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      emptyMessage="No unresolved QC violations."
    />
  );
}
