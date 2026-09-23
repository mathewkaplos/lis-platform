'use client';

import { useActionState, useState } from 'react';
import {
  Button,
  DataTable,
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
import type { InstrumentAnalyteMappingResult } from '@lis/domain';
import { createInstrumentAnalyteMapping } from './actions';
import { createInstrumentAnalyteMappingInitialState } from './types';

export type InstrumentAnalyteMappingRow = InstrumentAnalyteMappingResult;
export interface AnalyteOption {
  id: string;
  display: string;
  unitId: string | null;
  unitDisplay: string | null;
}

/**
 * Issue #812 (docs/plans/task-812-instrument-analyte-mapping-admin-ui.md).
 * Mirrors `ReferenceRangesTable`'s own shape exactly: a `DataTable` of
 * existing mappings plus a `SlideOver`-hosted add-only form. `unitId` is
 * submitted as a hidden field, auto-populated from the selected analyte's
 * own canonical unit -- no separate unit-picker UI, same precedent
 * `reference-ranges-table.tsx` already established.
 */
export function InstrumentMappingsTable({
  isQa,
  initialRows,
  analyteOptions,
}: {
  isQa: boolean;
  initialRows: InstrumentAnalyteMappingRow[];
  analyteOptions: AnalyteOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [selectedAnalyteId, setSelectedAnalyteId] = useState<string>(
    analyteOptions[0]?.id ?? '',
  );
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createInstrumentAnalyteMapping,
    createInstrumentAnalyteMappingInitialState,
  );

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'created' && state.createdMapping) {
      setRows((prev) => [state.createdMapping!, ...prev]);
      setOpen(false);
    }
  }

  const selectedAnalyte = analyteOptions.find((a) => a.id === selectedAnalyteId);

  const columns: DataTableColumn<InstrumentAnalyteMappingRow>[] = [
    { id: 'instrumentId', header: 'Instrument', cell: (row) => row.instrumentId },
    { id: 'channelCode', header: 'Channel code', cell: (row) => row.channelCode },
    {
      id: 'analyte',
      header: 'Analyte',
      cell: (row) => <span className="font-medium text-foreground">{row.analyteDisplay}</span>,
      sortable: true,
      sortValue: (row) => row.analyteDisplay,
    },
    { id: 'unit', header: 'Unit', cell: (row) => row.unitDisplay ?? '—' },
    { id: 'conversionFactor', header: 'Conversion factor', cell: (row) => row.conversionFactor },
    { id: 'status', header: 'Status', cell: (row) => row.status },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isQa ? (
          <SlideOver open={open} onOpenChange={setOpen}>
            <SlideOverTrigger asChild>
              <Button>Add mapping</Button>
            </SlideOverTrigger>
            <SlideOverContent>
              <SlideOverHeader>
                <SlideOverTitle>Add instrument-analyte mapping</SlideOverTitle>
                <SlideOverDescription>
                  Adds a new, published mapping — never edits or archives an existing one.
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
                  id="instrumentId"
                  label="Instrument ID"
                  required
                  errorText={state.fieldErrors?.instrumentId?.[0]}
                >
                  <Input name="instrumentId" />
                </FormField>
                <FormField
                  id="channelCode"
                  label="Channel code"
                  required
                  errorText={state.fieldErrors?.channelCode?.[0]}
                >
                  <Input name="channelCode" />
                </FormField>
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
                <FormField
                  id="conversionFactor"
                  label="Conversion factor"
                  helperText="instrument_value × factor = canonical value. Leave blank for 1."
                  errorText={state.fieldErrors?.conversionFactor?.[0]}
                >
                  <Input type="number" step="any" name="conversionFactor" defaultValue="1" />
                </FormField>
                <SlideOverFooter className="flex-row justify-end gap-2 px-0">
                  <SlideOverClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </SlideOverClose>
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Saving…' : 'Save mapping'}
                  </Button>
                </SlideOverFooter>
              </form>
            </SlideOverContent>
          </SlideOver>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        emptyMessage="No instrument-analyte mappings configured yet."
      />
    </div>
  );
}
