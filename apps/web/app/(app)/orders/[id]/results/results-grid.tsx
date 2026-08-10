'use client';

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, DataTable, Input, StatusPill, type ResultFlag } from '@lis/ui';
import { getCalculatedAnalyteDefinition, isCalculatedAnalyteCode, type MorphologyGrade } from '@lis/domain';
import {
  draftMorphologyResult,
  draftNarrative,
  draftResult,
  finalizeMorphologyResult,
  finalizeResult,
  verifyResult,
  type CalculatedDependentOutcome,
} from './actions';

/** FEAT-024 (ADR-0025): the shared grading vocabulary rendered as a small
 * button group -- mirrors `morphologyGradeSchema` (`@lis/domain`) exactly. */
const MORPHOLOGY_GRADES: MorphologyGrade[] = ['none', '1+', '2+', '3+'];

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
  /** FEAT-024 (ADR-0025): the only two dataTypes the parent Server Component
   * ever lets through (`page.tsx`'s own filter) -- selects which control
   * this grid's "Result" column renders. */
  dataType: 'quantity' | 'ordinal';
  unit: string | null;
  initialValueNum: number | null;
  /** FEAT-024 (ADR-0025): only ever non-null for an `ordinal` row. */
  initialValueCode: string | null;
  initialNotes: string | null;
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
  /** FEAT-024 (ADR-0025): only meaningful for an `ordinal` row. */
  valueCode: string | null;
  notes: string;
  /** FEAT-042: true only while `notes` currently holds an AI-drafted
   * narrative (accepted verbatim or edited) -- reset to false the moment
   * the technologist clears the field or types their own note instead of
   * ever calling draft-narrative. */
  notesAiOriginated: boolean;
  notesAiDisposition: 'accepted' | 'edited' | null;
  /** FEAT-042: true only while a draft-narrative request is in flight for
   * this row -- separate from `pending` (grade/finalize save) so the two
   * loading states never fight over the same disabled/label logic. */
  narrativePending: boolean;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified' | null;
  verifierUserId: string | null;
  verifiedAt: string | null;
  pending: boolean;
  error: string | null;
  // ADR-0021 / issue #400: set only when finalizeResult() returns
  // status: 'held' -- the write succeeded, distinct from `error` so it never
  // renders with `error`'s danger styling over a value that wasn't lost.
  heldMessage: string | null;
  // TASK-390 (issue #390): which post-commit branch held the panel -- only
  // 'qc_violation' gets a /qc-violations pointer; 'unacknowledged_critical'
  // keeps TASK-400's original caption unchanged (its own resolution affordance,
  // Verify, is already on this same grid).
  heldReason: 'unacknowledged_critical' | 'qc_violation' | null;
}

function rowKey(row: Pick<ResultRow, 'orderedTestId' | 'analyteId'>): string {
  return `${row.orderedTestId}:${row.analyteId}`;
}

function isFlag(value: string): value is ResultFlag {
  return (
    value === 'N' || value === 'H' || value === 'L' || value === 'HH' || value === 'LL' || value === 'A' || value === 'D'
  );
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
          valueCode: row.initialValueCode,
          notes: row.initialNotes ?? '',
          notesAiOriginated: false,
          notesAiDisposition: null,
          narrativePending: false,
          flags: row.initialFlags,
          refLow: row.initialRefLow,
          refHigh: row.initialRefHigh,
          observationStatus: row.initialObservationStatus,
          verifierUserId: row.initialVerifierUserId,
          verifiedAt: row.initialVerifiedAt,
          pending: false,
          error: null,
          heldMessage: null,
          heldReason: null,
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
    updateRow(key, { pending: true, error: null, heldMessage: null, heldReason: null });
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
    updateRow(key, { pending: true, error: null, heldMessage: null, heldReason: null });
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
      heldMessage: null,
      heldReason: null,
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
    updateRow(key, { pending: true, error: null, heldMessage: null, heldReason: null });
    startTransition(async () => {
      const outcome = await finalizeResult(row.orderedTestId, row.analyteId, parsed);
      if (outcome.status === 'error') {
        updateRow(key, { pending: false, error: outcome.error ?? 'Something went wrong.' });
        return;
      }
      // ADR-0021 / issue #400: 'held' means the write committed but the
      // panel can't close yet -- the real, already-persisted value (not the
      // FAILURE-shaped placeholder a plain 409 would imply), plus an
      // informational caption instead of a danger-colored error.
      if (outcome.status === 'held') {
        updateRow(key, {
          pending: false,
          text: outcome.valueNum === null ? state.text : String(outcome.valueNum),
          flags: outcome.flags,
          refLow: outcome.refLow,
          refHigh: outcome.refHigh,
          observationStatus: outcome.observationStatus,
          heldMessage: outcome.heldMessage ?? 'panel held pending an unrelated result.',
          heldReason: outcome.heldReason ?? null,
        });
        for (const dependent of outcome.calculatedDependents ?? []) {
          applyCalculatedDependent(row.orderedTestId, dependent);
        }
        focusNextEnterable(index);
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

  /**
   * FEAT-024 (ADR-0025): a morphology grade is a discrete, complete choice
   * the moment it's clicked -- unlike a partially-typed number, there's no
   * natural "still mid-edit" state to wait out with a blur event. Autosaves
   * (drafts) immediately on click, same semantic role as `handleBlur` above,
   * reacting to a click instead of a blur. Carries whatever `notes` text is
   * currently in the row's own local state, so a note typed before a grade
   * is chosen isn't lost.
   */
  function handleGradeSelect(row: ResultRow, grade: MorphologyGrade) {
    const key = rowKey(row);
    const state = rowStates[key];
    updateRow(key, { valueCode: grade, pending: true, error: null, heldMessage: null, heldReason: null });
    startTransition(async () => {
      const outcome = await draftMorphologyResult(
        row.orderedTestId,
        row.analyteId,
        grade,
        state.notes || undefined,
        state.notesAiOriginated || undefined,
        state.notesAiDisposition ?? undefined,
      );
      if (outcome.status === 'error') {
        updateRow(key, { pending: false, error: outcome.error ?? 'Something went wrong.' });
        return;
      }
      updateRow(key, {
        pending: false,
        valueCode: outcome.valueCode ?? grade,
        notes: outcome.notes ?? state.notes,
        flags: outcome.flags,
        refLow: outcome.refLow,
        refHigh: outcome.refHigh,
        observationStatus: outcome.observationStatus,
      });
    });
  }

  /**
   * FEAT-042: proposes a starter narrative for the grade just drafted
   * (`handleGradeSelect` above already autosaved it -- the API reads that
   * persisted value, never a client-supplied one). Populates `notes` and
   * marks it AI-originated/`accepted`; any subsequent edit to the textarea
   * flips the disposition to `edited` (see `onChange` below) without ever
   * clearing `notesAiOriginated` -- KB-11's "accept or edit," both still
   * AI-originated, distinct only in whether the technologist changed it.
   */
  function handleDraftNarrative(row: ResultRow) {
    const key = rowKey(row);
    updateRow(key, { narrativePending: true, error: null });
    startTransition(async () => {
      const outcome = await draftNarrative(row.orderedTestId, row.analyteId);
      if (outcome.status === 'error') {
        updateRow(key, { narrativePending: false, error: outcome.error });
        return;
      }
      updateRow(key, {
        narrativePending: false,
        notes: outcome.narrative,
        notesAiOriginated: true,
        notesAiDisposition: 'accepted',
      });
    });
  }

  /**
   * FEAT-024 (ADR-0025): the `ordinal` counterpart to `handleKeyDown` above
   * -- a dedicated button rather than an `Enter` keystroke, since there's no
   * text field whose `Enter` press would naturally mean "finalize" for a
   * button-group control. Mirrors the same `held`/error/calculatedDependents
   * handling.
   */
  function handleMorphologyFinalize(row: ResultRow, index: number) {
    const key = rowKey(row);
    const state = rowStates[key];
    if (!state.valueCode) return; // nothing graded yet -- button is hidden in this case, defensive only
    const grade = state.valueCode as MorphologyGrade;
    updateRow(key, { pending: true, error: null, heldMessage: null, heldReason: null });
    startTransition(async () => {
      const outcome = await finalizeMorphologyResult(
        row.orderedTestId,
        row.analyteId,
        grade,
        state.notes || undefined,
        state.notesAiOriginated || undefined,
        state.notesAiDisposition ?? undefined,
      );
      if (outcome.status === 'error') {
        updateRow(key, { pending: false, error: outcome.error ?? 'Something went wrong.' });
        return;
      }
      if (outcome.status === 'held') {
        updateRow(key, {
          pending: false,
          valueCode: outcome.valueCode ?? state.valueCode,
          notes: outcome.notes ?? state.notes,
          flags: outcome.flags,
          refLow: outcome.refLow,
          refHigh: outcome.refHigh,
          observationStatus: outcome.observationStatus,
          heldMessage: outcome.heldMessage ?? 'panel held pending an unrelated result.',
          heldReason: outcome.heldReason ?? null,
        });
        focusNextEnterable(index);
        return;
      }
      updateRow(key, {
        pending: false,
        valueCode: outcome.valueCode ?? state.valueCode,
        notes: outcome.notes ?? state.notes,
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
          id: 'prior',
          header: 'Prior result',
          // TASK-057 (FEAT-015 revision §1 finding #3/§10 Q1): the patient's
          // own most recent prior result for this analyte -- raw value only.
          // FEAT-025 (ADR-0023) now computes a real delta check server-side,
          // but surfaces it as a `D` flag in the adjacent Flag column, not as
          // percent-change text in this column -- this column's own scope
          // stays a plain prior-value display (proposal §10 scope decision).
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

            // FEAT-024 (ADR-0025): a graded button-group + optional
            // narrative, not a numeric input -- KB-19's own "ordinal graded
            // controls" framing, Stitch §12.2. `Button` (already used
            // elsewhere in this file/app for a toggle-like control, e.g.
            // `page.tsx`'s own stage tabs), not a new `packages/ui`
            // primitive -- no second consumer to justify one yet.
            if (row.dataType === 'ordinal') {
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1" role="group" aria-label={`${row.analyteDisplay} grade`}>
                    {MORPHOLOGY_GRADES.map((grade) => (
                      <Button
                        key={grade}
                        type="button"
                        size="sm"
                        variant={state.valueCode === grade ? 'default' : 'outline'}
                        aria-pressed={state.valueCode === grade}
                        disabled={!enterable || state.pending}
                        onClick={() => handleGradeSelect(row, grade)}
                      >
                        {grade}
                      </Button>
                    ))}
                  </div>
                  {enterable && state.valueCode ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={state.pending || state.narrativePending}
                      onClick={() => handleDraftNarrative(row)}
                    >
                      {state.narrativePending ? 'Drafting…' : 'Draft with AI'}
                    </Button>
                  ) : null}
                  {state.notesAiOriginated ? (
                    <Badge variant="secondary" aria-label="AI-drafted narrative, review before finalizing">
                      {state.notesAiDisposition === 'edited' ? 'AI draft (edited)' : 'AI draft — review before finalizing'}
                    </Badge>
                  ) : null}
                  <textarea
                    aria-label={`${row.analyteDisplay} notes`}
                    placeholder="Notes (optional)"
                    value={state.notes}
                    disabled={!enterable || state.pending}
                    onChange={(e) =>
                      updateRow(key, {
                        notes: e.target.value,
                        notesAiDisposition: state.notesAiOriginated ? 'edited' : state.notesAiDisposition,
                      })
                    }
                    rows={2}
                    className="w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  {enterable && state.valueCode ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={state.pending}
                      onClick={() => handleMorphologyFinalize(row, index)}
                    >
                      Finalize
                    </Button>
                  ) : null}
                  {!enterable && row.orderedTestStatus === 'ordered' ? (
                    <span className="text-xs text-text-secondary">Not yet received</span>
                  ) : null}
                  {state.error ? (
                    <span role="alert" className="text-xs text-danger">
                      {state.error}
                    </span>
                  ) : null}
                  {state.heldMessage && state.heldReason === 'qc_violation' ? (
                    <span role="status" className="text-xs text-warning">
                      Saved — held on a QC violation.{' '}
                      <Link href="/qc-violations" className="underline">
                        See QC violations →
                      </Link>
                    </span>
                  ) : state.heldMessage ? (
                    <span role="status" className="text-xs text-warning">
                      Saved — {state.heldMessage}
                    </span>
                  ) : null}
                </div>
              );
            }

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
                {state.heldMessage && state.heldReason === 'qc_violation' ? (
                  <span role="status" className="text-xs text-warning">
                    Saved — held on a QC violation.{' '}
                    <Link href="/qc-violations" className="underline">
                      See QC violations →
                    </Link>
                  </span>
                ) : state.heldMessage ? (
                  <span role="status" className="text-xs text-warning">
                    Saved — {state.heldMessage}
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
            // FEAT-025 (ADR-0023): a result can carry more than one flag at
            // once (e.g. `HH` + `D` -- a critical value that's also an
            // implausible jump from the prior result, KB-14's own worked
            // example). Render every recognized flag, not just the first --
            // a single-pill `[flag] = state.flags` read would silently drop
            // any flag after the first, same class of bug as an unrecognized
            // flag being dropped by `isFlag` itself.
            const flags = state.flags.filter(isFlag);
            if (flags.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-1">
                {flags.map((flag) => (
                  <StatusPill key={flag} flag={flag} />
                ))}
              </div>
            );
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
