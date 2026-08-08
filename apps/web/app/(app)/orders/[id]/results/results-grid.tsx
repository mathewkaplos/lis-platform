'use client';

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Button, DataTable, Input, StatusPill, type ResultFlag } from '@lis/ui';
import { getCalculatedAnalyteDefinition, isCalculatedAnalyteCode } from '@lis/domain';
import { draftResult, finalizeResult, verifyResult, type CalculatedDependentOutcome } from './actions';

/** TASK-057 (FEAT-015 revision §2/§10 Q1): mirrors the API's own
 * `PriorObservation` shape (`packages/domain/src/observation.ts`) -- the
 * patient's own prior result(s) for this analyte, most recent first, no
 * computed delta. */
export interface PriorResult {
  id: string;
  orderedTestId: string;
  valueNum: number | null;
  valueCode: string | null;
  valueText: string | null;
  unit: string | null;
  flags: string[];
  producedAt: string | null;
  createdAt: string;
}

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
  // @lis/sdk's now-wider shared ObservationDto/observationStatusSchema shape
  // (list() can genuinely return a verified row now). TASK-057 adds the
  // actual 'verified' UI treatment below (status column, Verify column).
  initialObservationStatus: 'registered' | 'preliminary' | 'verified' | null;
  // TASK-057 (FEAT-015 revision §2/§10 Q4): both null unless this row is
  // already 'verified' -- widened `observationSchema` fields, set only by
  // `verify()`.
  initialVerifierUserId: string | null;
  initialVerifiedAt: string | null;
  // TASK-057 (FEAT-015 revision §1 finding #3/§10 Q1): the patient's own
  // prior result(s) for this analyte -- fetched once by the parent Server
  // Component alongside this row's own current result, never refetched on
  // verify (a just-verified row's own prior list is unaffected by verifying
  // it).
  priorResults: PriorResult[];
}

interface RowState {
  text: string;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified' | null;
  verifierUserId: string | null;
  verifiedAt: string | null;
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
 * updates that OTHER row's own state too, via `calculatedDependents` in the
 * finalize outcome -- no full-page reload needed to see it appear.
 * TASK-072 (FEAT-023): `calculatedDependents` is an array -- finalizing WBC
 * after all five differential percentages are already entered cascades all
 * five absolute-count rows at once, not just one.
 *
 * TASK-057 (FEAT-015 revision §1 finding #4/§2): a "Verify" affordance per
 * row where `observationStatus === 'preliminary'` AND the caller holds the
 * `verifier` role (`isVerifier` prop, §10 Q3) -- hidden entirely, not just
 * disabled, for a technologist-roled session. `isVerifiable`/
 * `focusNextVerifiable` mirror `isEnterable`/`focusNextEnterable` above
 * exactly, with their own ref map (`verifyButtonRefs`) since a `<button>`,
 * not an `<input>`, is what needs focus after each verify -- native button
 * `keydown` handling means Enter/Space already activates it with no custom
 * `onKeyDown` needed (keyboard-only, no mouse, matches this grid's existing
 * AC for finalize).
 */
export function ResultsGrid({ rows, isVerifier }: { rows: ResultRow[]; isVerifier: boolean }) {
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
          verifierUserId: row.initialVerifierUserId,
          verifiedAt: row.initialVerifiedAt,
          pending: false,
          error: null,
        } satisfies RowState,
      ]),
    ),
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const verifyButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function isEnterable(row: ResultRow): boolean {
    if (isCalculatedAnalyteCode(row.analyteCode)) return false; // never manually entered
    const state = rowStates[rowKey(row)];
    return (
      (row.orderedTestStatus === 'received' || row.orderedTestStatus === 'in_process') &&
      state.observationStatus !== 'preliminary'
    );
  }

  // No ordered-test-status condition -- `verify()` itself has no such gate
  // (`domain/result-verification` Skill entry #6), only `observationStatus`.
  function isVerifiable(row: ResultRow): boolean {
    if (!isVerifier) return false;
    return rowStates[rowKey(row)].observationStatus === 'preliminary';
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

  function focusNextVerifiable(fromIndex: number) {
    for (let i = fromIndex + 1; i < rows.length; i++) {
      if (isVerifiable(rows[i])) {
        verifyButtonRefs.current[rowKey(rows[i])]?.focus();
        return;
      }
    }
  }

  function handleVerify(row: ResultRow, index: number) {
    const key = rowKey(row);
    updateRow(key, { pending: true, error: null });
    startTransition(async () => {
      const outcome = await verifyResult(row.orderedTestId, row.analyteId);
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
        verifierUserId: outcome.verifierUserId ?? null,
        verifiedAt: outcome.verifiedAt ?? null,
      });
      focusNextVerifiable(index);
    });
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
      for (const dependent of outcome.calculatedDependents ?? []) {
        applyCalculatedDependent(row.orderedTestId, dependent);
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
          id: 'prior',
          header: 'Prior result',
          // TASK-057 (FEAT-015 revision §1 finding #3/§10 Q1): the patient's
          // own most recent prior result for this analyte -- raw value only,
          // no computed delta/percent-change (unconditionally out of scope).
          cell: (row) => {
            const [mostRecent] = row.priorResults;
            if (!mostRecent) {
              return <span className="text-xs text-text-secondary">No prior result</span>;
            }
            const value = mostRecent.valueNum ?? mostRecent.valueCode ?? mostRecent.valueText ?? '—';
            const when = mostRecent.producedAt ?? mostRecent.createdAt;
            return (
              <span className="text-xs text-text-secondary">
                {value}
                {row.unit ? ` ${row.unit}` : ''}
                {when ? ` (${new Date(when).toLocaleDateString()})` : ''}
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
            // TASK-057 (FEAT-015 revision §2): 'verified' finally gets its
            // own treatment -- previously fell through to `null`, per this
            // file's own now-superseded TASK-055 comment.
            if (state.observationStatus === 'verified') return <span className="text-sm text-info">Verified</span>;
            if (state.observationStatus === 'preliminary') return <span className="text-sm text-success">Finalized</span>;
            if (state.observationStatus === 'registered') return <span className="text-sm text-text-secondary">Draft</span>;
            return null;
          },
        },
        {
          id: 'verify',
          header: 'Verify',
          // TASK-057 (FEAT-015 revision §2/§10 Q3/Q4): entirely hidden for a
          // non-verifier session (`isVerifier` gates `isVerifiable` itself),
          // not merely disabled -- avoids a control that always fails for
          // the wrong-roled caller.
          cell: (row) => {
            const key = rowKey(row);
            const state = rowStates[key];
            const index = rows.indexOf(row);

            if (state.observationStatus === 'verified') {
              return (
                <span className="text-xs text-text-secondary">
                  Verified by {state.verifierUserId ? state.verifierUserId.slice(0, 8) : 'unknown'}
                  {state.verifiedAt ? ` · ${new Date(state.verifiedAt).toLocaleString()}` : ''}
                </span>
              );
            }
            if (!isVerifiable(row)) return null;
            return (
              <Button
                ref={(el) => {
                  verifyButtonRefs.current[key] = el;
                }}
                type="button"
                size="sm"
                variant="outline"
                disabled={state.pending}
                onClick={() => handleVerify(row, index)}
              >
                Verify
              </Button>
            );
          },
        },
      ]}
      data={rows}
      getRowId={(row) => rowKey(row)}
      emptyMessage="No tests ready for result entry."
    />
  );
}
