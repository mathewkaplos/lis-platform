'use client';

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { DataTable, Input, StatusPill, type ResultFlag } from '@lis/ui';
import { getCalculatedAnalyteDefinition, isCalculatedAnalyteCode } from '@lis/domain';
import { draftResult, finalizeResult, type CalculatedDependentOutcome } from './actions';

export interface ResultRow {
  orderedTestId: string;
  orderedTestStatus: string;
  testDisplayName: string;
  analyteId: string;
  /** TASK-053 (FEAT-014 revision §2): the analyte's own LOINC code -- the
   * only signal the grid has for "this row is calculated" (`@lis/domain`'s
   * `isCalculatedAnalyteCode`), without a new schema flag. */
  analyteCode: string;
  analyteDisplay: string;
  unit: string | null;
  initialValueNum: number | null;
  initialFlags: string[];
  initialRefLow: number | null;
  initialRefHigh: number | null;
  // TASK-055: widened to include 'verified' so this grid type-checks against
  // @lis/sdk's now-wider shared ObservationDto/observationStatusSchema
  // shape (list() can genuinely return a verified row now). No new UI
  // treatment for 'verified' is added here -- that's TASK-057's own scope
  // (verification UI); a verified row currently renders with neither the
  // "Draft" nor "Finalized" pill below, same as any other unhandled status.
  initialObservationStatus: 'registered' | 'preliminary' | 'verified' | null;
}

interface RowState {
  text: string;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified' | null;
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
 *
 * TASK-053 (FEAT-014 revision §2): a row whose analyte code is calculated
 * (eGFR/LDL) renders read-only -- no `<Input>`, not part of the Tab order,
 * nothing to type -- showing its computed value (or "Pending inputs" before
 * its dependencies are all finalized) with the formula available via the
 * native `title` attribute on hover (the literal "shown on hover" AC; no
 * `packages/ui` Tooltip primitive exists yet). Finalizing a manual analyte
 * that cascades a calculated dependent (server-side, same transaction)
 * updates that OTHER row's own state too, via `calculatedDependent` in the
 * finalize outcome -- no full-page reload needed to see it appear.
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
    if (isCalculatedAnalyteCode(row.analyteCode)) return false; // never manually entered
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

  function applyCalculatedDependent(orderedTestId: string, dependent: CalculatedDependentOutcome) {
    const dependentKey = rowKey({ orderedTestId, analyteId: dependent.analyteId });
    if (!(dependentKey in rowStates)) return; // not one of this order's own rows (shouldn't happen, defensive)
    updateRow(dependentKey, {
      text: dependent.valueNum === null ? '' : String(dependent.valueNum),
      flags: dependent.flags,
      refLow: dependent.refLow,
      refHigh: dependent.refHigh,
      observationStatus: dependent.observationStatus,
      pending: false,
      error: null,
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
      if (outcome.calculatedDependent) {
        applyCalculatedDependent(row.orderedTestId, outcome.calculatedDependent);
      }
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

            if (isCalculatedAnalyteCode(row.analyteCode)) {
              const formula = getCalculatedAnalyteDefinition(row.analyteCode)?.formula ?? '';
              return (
                <span
                  className="max-w-32 text-foreground"
                  title={formula}
                  aria-label={`${row.analyteDisplay} result (calculated): ${formula}`}
                >
                  {state.text === '' ? (
                    <span className="text-text-secondary">Pending inputs</span>
                  ) : (
                    state.text
                  )}
                </span>
              );
            }

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
