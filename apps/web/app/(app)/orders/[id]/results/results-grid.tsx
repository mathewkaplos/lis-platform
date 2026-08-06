'use client';

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { DataTable, Input, StatusPill, type ResultFlag } from '@lis/ui';
import { draftResult, finalizeResult } from './actions';

export interface ResultRow {
  orderedTestId: string;
  orderedTestStatus: string;
  testDisplayName: string;
  analyteId: string;
  analyteDisplay: string;
  unit: string | null;
  initialValueNum: number | null;
  initialFlags: string[];
  initialRefLow: number | null;
  initialRefHigh: number | null;
  initialObservationStatus: 'registered' | 'preliminary' | null;
}

interface RowState {
  text: string;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | null;
  pending: boolean;
  error: string | null;
}

function rowKey(row: Pick<ResultRow, 'orderedTestId' | 'analyteId'>): string {
  return `${row.orderedTestId}:${row.analyteId}`;
}

function isFlag(value: string): value is ResultFlag {
  return value === 'N' || value === 'H' || value === 'L' || value === 'HH' || value === 'LL' || value === 'A';
}

function referenceRangeText(low: number | null, high: number | null): string {
  if (low === null && high === null) return '—';
  if (low === null) return `≤ ${high}`;
  if (high === null) return `≥ ${low}`;
  return `${low} – ${high}`;
}

/**
 * TASK-052 (FEAT-014 revision §2/§5). `packages/ui`'s `DataTable` hosts a
 * custom cell renderer per row (`engineering/frontend-design`'s own
 * compose-from-primitives discipline) rather than a bespoke table --
 * `StatusPill` (TASK-035/036) renders the flag, previously built but never
 * consumed until this task (proposal §1 finding #3).
 *
 * Autosave on blur, `Enter` finalizes and advances focus to the next
 * enterable row -- the literal AC ("entered without touching the mouse").
 * Quantity-only input rendering (proposal §5) -- `coded`/`text` rows are
 * filtered out by the parent Server Component before reaching this table,
 * since no real catalog data backs either shape yet.
 */
export function ResultsGrid({ rows }: { rows: ResultRow[] }) {
  const [, startTransition] = useTransition();
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        rowKey(row),
        {
          text: row.initialValueNum === null ? '' : String(row.initialValueNum),
          flags: row.initialFlags,
          refLow: row.initialRefLow,
          refHigh: row.initialRefHigh,
          observationStatus: row.initialObservationStatus,
          pending: false,
          error: null,
        } satisfies RowState,
      ]),
    ),
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function isEnterable(row: ResultRow): boolean {
    const state = rowStates[rowKey(row)];
    return (
      (row.orderedTestStatus === 'received' || row.orderedTestStatus === 'in_process') &&
      state.observationStatus !== 'preliminary'
    );
  }

  function updateRow(key: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function focusNextEnterable(fromIndex: number) {
    for (let i = fromIndex + 1; i < rows.length; i++) {
      if (isEnterable(rows[i])) {
        inputRefs.current[rowKey(rows[i])]?.focus();
        return;
      }
    }
  }

  function handleBlur(row: ResultRow) {
    const key = rowKey(row);
    const state = rowStates[key];
    const parsed = state.text.trim() === '' ? null : Number(state.text);
    if (parsed === null || Number.isNaN(parsed)) {
      return; // nothing entered yet, or mid-edit -- draft only on a real number
    }
    updateRow(key, { pending: true, error: null });
    startTransition(async () => {
      const outcome = await draftResult(row.orderedTestId, row.analyteId, parsed);
      if (outcome.status === 'error') {
        updateRow(key, { pending: false, error: outcome.error ?? 'Something went wrong.' });
        return;
      }
      updateRow(key, {
        pending: false,
        flags: outcome.flags,
        refLow: outcome.refLow,
        refHigh: outcome.refHigh,
        observationStatus: outcome.observationStatus,
      });
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, row: ResultRow, index: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const key = rowKey(row);
    const state = rowStates[key];
    const parsed = state.text.trim() === '' ? null : Number(state.text);
    if (parsed === null || Number.isNaN(parsed)) {
      return;
    }
    updateRow(key, { pending: true, error: null });
    startTransition(async () => {
      const outcome = await finalizeResult(row.orderedTestId, row.analyteId, parsed);
      if (outcome.status === 'error') {
        updateRow(key, { pending: false, error: outcome.error ?? 'Something went wrong.' });
        return;
      }
      updateRow(key, {
        pending: false,
        flags: outcome.flags,
        refLow: outcome.refLow,
        refHigh: outcome.refHigh,
        observationStatus: outcome.observationStatus,
      });
      focusNextEnterable(index);
    });
  }

  return (
    <DataTable
      columns={[
        {
          id: 'analyte',
          header: 'Test',
          cell: (row) => <span className="text-foreground">{row.analyteDisplay || row.testDisplayName}</span>,
        },
        {
          id: 'range',
          header: 'Reference range',
          cell: (row) => {
            const state = rowStates[rowKey(row)];
            return (
              <span className="text-sm text-text-secondary">
                {referenceRangeText(state.refLow, state.refHigh)}
                {row.unit ? ` ${row.unit}` : ''}
              </span>
            );
          },
        },
        {
          id: 'result',
          header: 'Result',
          cell: (row) => {
            const key = rowKey(row);
            const state = rowStates[key];
            const index = rows.indexOf(row);
            const enterable = isEnterable(row);
            return (
              <div className="flex flex-col gap-1">
                <Input
                  ref={(el) => {
                    inputRefs.current[key] = el;
                  }}
                  type="number"
                  step="any"
                  aria-label={`${row.analyteDisplay} result`}
                  value={state.text}
                  disabled={!enterable || state.pending}
                  onChange={(e) => updateRow(key, { text: e.target.value })}
                  onBlur={() => handleBlur(row)}
                  onKeyDown={(e) => handleKeyDown(e, row, index)}
                  className="max-w-32"
                />
                {!enterable && row.orderedTestStatus === 'ordered' ? (
                  <span className="text-xs text-text-secondary">Not yet received</span>
                ) : null}
                {state.error ? (
                  <span role="alert" className="text-xs text-danger">
                    {state.error}
                  </span>
                ) : null}
              </div>
            );
          },
        },
        {
          id: 'flag',
          header: 'Flag',
          cell: (row) => {
            const state = rowStates[rowKey(row)];
            const [flag] = state.flags;
            return flag && isFlag(flag) ? <StatusPill flag={flag} /> : null;
          },
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => {
            const state = rowStates[rowKey(row)];
            if (state.observationStatus === 'preliminary') return <span className="text-sm text-success">Finalized</span>;
            if (state.observationStatus === 'registered') return <span className="text-sm text-text-secondary">Draft</span>;
            return null;
          },
        },
      ]}
      data={rows}
      getRowId={(row) => rowKey(row)}
      emptyMessage="No tests ready for result entry."
    />
  );
}
