'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  FilterBar,
  FormField,
  Input,
  SlideOver,
  SlideOverClose,
  SlideOverContent,
  SlideOverDescription,
  SlideOverFooter,
  SlideOverHeader,
  SlideOverTitle,
  SlideOverTrigger,
  type DataTableColumn,
} from '@lis/ui';
import type { ReferenceRangeResult } from '@lis/domain';
import { createReferenceRange } from './actions';
import { createReferenceRangeInitialState } from './types';

export type ReferenceRangeRow = ReferenceRangeResult;
export interface AnalyteOption {
  id: string;
  display: string;
  unitId: string | null;
  unitDisplay: string | null;
}

function formatAgeBand(row: ReferenceRangeRow): string {
  if (row.ageLowDays === null && row.ageHighDays === null) return 'Any';
  const low = row.ageLowDays !== null ? Math.round(row.ageLowDays / 365.25) : 0;
  const high = row.ageHighDays !== null ? Math.round(row.ageHighDays / 365.25) : '∞';
  return `${low}–${high}y`;
}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). §20.4: a filterable
 * `DataTable` of reference ranges, plus a `SlideOver`-hosted add form
 * (`useActionState`, mirroring `patients/new/page.tsx`'s own Server-Action
 * form shape, hosted in a slide-over rather than a full page per §20.4's
 * own "Pattern A + editor" framing). Add-only (§10 Q3) -- this component
 * never renders an edit/archive control.
 */
export function ReferenceRangesTable({
  isQa,
  initialRows,
  analyteOptions,
}: {
  isQa: boolean;
  initialRows: ReferenceRangeRow[];
  analyteOptions: AnalyteOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [analyteFilter, setAnalyteFilter] = useState<string | null>(null);
  const [selectedAnalyteId, setSelectedAnalyteId] = useState<string>(
    analyteOptions[0]?.id ?? '',
  );
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createReferenceRange,
    createReferenceRangeInitialState,
  );

  // React's own documented "adjusting state when a prop changes" pattern
  // (setState during render, not inside an effect) -- avoids the extra
  // effect-triggered render pass `react-hooks/set-state-in-effect` flags.
  // Tracked via a second `useState`, not `useRef`: this codebase's eslint
  // config (`react-hooks/refs`) forbids reading/writing a ref's `.current`
  // during render, matching React's own docs example for this exact
  // pattern, which also uses `useState` for the "previous value" slot.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'created' && state.createdRange) {
      setRows((prev) => [state.createdRange!, ...prev]);
      setOpen(false);
    }
  }

  const selectedAnalyte = analyteOptions.find((a) => a.id === selectedAnalyteId);

  const filteredRows = useMemo(
    () => (analyteFilter ? rows.filter((row) => row.analyteId === analyteFilter) : rows),
    [rows, analyteFilter],
  );

  const columns: DataTableColumn<ReferenceRangeRow>[] = [
    {
      id: 'analyte',
      header: 'Analyte',
      cell: (row) => <span className="font-medium text-foreground">{row.analyteDisplay}</span>,
      sortable: true,
      sortValue: (row) => row.analyteDisplay,
    },
    { id: 'sex', header: 'Sex', cell: (row) => row.sex ?? 'Any' },
    { id: 'age', header: 'Age band', cell: formatAgeBand },
    { id: 'method', header: 'Method', cell: (row) => row.method ?? '—' },
    {
      id: 'range',
      header: 'Range',
      cell: (row) =>
        row.textualRange ??
        `${row.low ?? '−∞'} – ${row.high ?? '∞'} ${row.unitDisplay ?? ''}`.trim(),
    },
    {
      id: 'rangeType',
      header: 'Type',
      cell: (row) => row.rangeType,
    },
    {
      id: 'effectiveFrom',
      header: 'Effective from',
      cell: (row) => new Date(row.effectiveFrom).toLocaleDateString(),
      sortable: true,
      sortValue: (row) => row.effectiveFrom,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="analyte-filter" className="text-sm text-text-secondary">
            Filter by analyte
          </label>
          <select
            id="analyte-filter"
            value={analyteFilter ?? ''}
            onChange={(e) => setAnalyteFilter(e.target.value || null)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">All analytes</option>
            {analyteOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display}
              </option>
            ))}
          </select>
        </div>
        {isQa ? (
          <SlideOver open={open} onOpenChange={setOpen}>
            <SlideOverTrigger asChild>
              <Button>Add range</Button>
            </SlideOverTrigger>
            <SlideOverContent>
              <SlideOverHeader>
                <SlideOverTitle>Add reference range</SlideOverTitle>
                <SlideOverDescription>
                  Adds a new, additive range — never edits or ends an existing one.
                </SlideOverDescription>
              </SlideOverHeader>
              <form
                action={formAction}
                className="flex flex-col gap-4 overflow-y-auto px-4 py-2"
              >
                <input type="hidden" name="unitId" value={selectedAnalyte?.unitId ?? ''} />
                {state.status === 'error' && state.formError ? (
                  <p role="alert" className="text-sm text-danger">
                    {state.formError}
                  </p>
                ) : null}
                <FormField
                  id="analyteId"
                  label="Analyte"
                  required
                  helperText={selectedAnalyte?.unitDisplay ? `Unit: ${selectedAnalyte.unitDisplay}` : undefined}
                  errorText={state.fieldErrors?.analyteId?.[0]}
                >
                  <select
                    id="analyteId"
                    name="analyteId"
                    required
                    value={selectedAnalyteId}
                    onChange={(e) => setSelectedAnalyteId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {analyteOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField id="rangeType" label="Range type" required errorText={state.fieldErrors?.rangeType?.[0]}>
                  <select
                    id="rangeType"
                    name="rangeType"
                    required
                    defaultValue="normal"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="normal">Normal</option>
                    <option value="therapeutic">Therapeutic</option>
                    <option value="critical">Critical</option>
                    <option value="reportable_absurd">Reportable/absurd</option>
                  </select>
                </FormField>
                <FormField id="sex" label="Sex" errorText={state.fieldErrors?.sex?.[0]}>
                  <select
                    id="sex"
                    name="sex"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">Any</option>
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                  </select>
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField id="ageLowDays" label="Age low (days)" errorText={state.fieldErrors?.ageLowDays?.[0]}>
                    <Input type="number" name="ageLowDays" />
                  </FormField>
                  <FormField id="ageHighDays" label="Age high (days)" errorText={state.fieldErrors?.ageHighDays?.[0]}>
                    <Input type="number" name="ageHighDays" />
                  </FormField>
                </div>
                <FormField id="method" label="Method" errorText={state.fieldErrors?.method?.[0]}>
                  <Input name="method" />
                </FormField>
                <FormField id="condition" label="Condition" errorText={state.fieldErrors?.condition?.[0]}>
                  <Input name="condition" />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField id="low" label="Low" errorText={state.fieldErrors?.low?.[0]}>
                    <Input type="number" step="any" name="low" />
                  </FormField>
                  <FormField id="high" label="High" errorText={state.fieldErrors?.high?.[0]}>
                    <Input type="number" step="any" name="high" />
                  </FormField>
                </div>
                <FormField
                  id="textualRange"
                  label="Textual range (non-numeric, e.g. 'Not detected')"
                  errorText={state.fieldErrors?.textualRange?.[0]}
                >
                  <Input name="textualRange" />
                </FormField>
                <FormField id="source" label="Source / citation" errorText={state.fieldErrors?.source?.[0]}>
                  <Input name="source" />
                </FormField>
                <SlideOverFooter className="flex-row justify-end gap-2 px-0">
                  <SlideOverClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </SlideOverClose>
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Saving…' : 'Save range'}
                  </Button>
                </SlideOverFooter>
              </form>
            </SlideOverContent>
          </SlideOver>
        ) : null}
      </div>
      {analyteFilter ? (
        <FilterBar
          filters={[
            {
              id: 'analyte',
              label: `Analyte: ${analyteOptions.find((a) => a.id === analyteFilter)?.display ?? ''}`,
            },
          ]}
          onRemove={() => setAnalyteFilter(null)}
        />
      ) : null}
      <DataTable
        columns={columns}
        data={filteredRows}
        getRowId={(row) => row.id}
        emptyMessage="No reference ranges configured yet."
      />
    </div>
  );
}
