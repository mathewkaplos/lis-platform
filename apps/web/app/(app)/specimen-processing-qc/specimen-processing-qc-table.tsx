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
import type { SpecimenProcessingBatch } from '@lis/domain';
import { recordSpecimenProcessingBatch } from './actions';
import { recordBatchInitialState } from './types';

export type SpecimenProcessingBatchRow = SpecimenProcessingBatch;
export interface CaseOption {
  id: string;
  accessionNumber: string;
  patientName: string;
}

const CRITERION_FIELDS: {
  id: string;
  label: string;
  options: [string, string][];
}[] = [
  {
    id: 'tissueFixation',
    label: 'Tissue fixation',
    options: [
      ['adequate', 'Adequate'],
      ['inadequate', 'Inadequate'],
    ],
  },
  {
    id: 'processing',
    label: 'Processing',
    options: [
      ['optimal', 'Optimal'],
      ['suboptimal', 'Suboptimal'],
    ],
  },
  {
    id: 'sectionThickness',
    label: 'Thickness of sections',
    options: [
      ['acceptable', 'Acceptable'],
      ['unacceptable', 'Unacceptable'],
    ],
  },
  {
    id: 'tissueFoldsTears',
    label: 'Interfering tissue folds and tears',
    options: [
      ['absent', 'Absent'],
      ['present', 'Present'],
    ],
  },
  {
    id: 'stainingQuality',
    label: 'Staining quality',
    options: [
      ['acceptable', 'Acceptable'],
      ['unacceptable', 'Unacceptable'],
    ],
  },
  {
    id: 'coverslipping',
    label: 'Coverslipping',
    options: [
      ['no_artefacts', 'No artefacts'],
      ['artefacts', 'Artefacts'],
    ],
  },
  {
    id: 'tissueOrientation',
    label: 'Tissue orientation and complete section',
    options: [
      ['satisfactory', 'Satisfactory'],
      ['unsatisfactory', 'Unsatisfactory'],
    ],
  },
];

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md).
 * A filterable `DataTable` of recorded batches, plus a `SlideOver`-hosted
 * recording form, mirroring `ReferenceRangesTable`'s own shape exactly. v1
 * records one case per submission (proposal's own disclosed UI-scope
 * narrowing — the API itself accepts N cases per batch).
 */
export function SpecimenProcessingQcTable({
  isPathologist,
  initialRows,
  caseOptions,
}: {
  isPathologist: boolean;
  initialRows: SpecimenProcessingBatchRow[];
  caseOptions: CaseOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(caseOptions[0]?.id ?? '');
  const [state, formAction, pending] = useActionState(
    recordSpecimenProcessingBatch,
    recordBatchInitialState,
  );

  // React's own documented "adjusting state when a prop changes" pattern —
  // same shape `ReferenceRangesTable`'s own identical block already uses.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === 'created' && state.createdBatch) {
      setRows((prev) => [state.createdBatch!, ...prev]);
      setOpen(false);
    }
  }

  const columns: DataTableColumn<SpecimenProcessingBatchRow>[] = [
    {
      id: 'grossingDate',
      header: 'Grossing date',
      cell: (row) => new Date(row.grossingDate).toLocaleDateString(),
      sortable: true,
      sortValue: (row) => row.grossingDate,
    },
    { id: 'histoTech', header: 'Histo tech', cell: (row) => row.histoTechName },
    {
      id: 'cases',
      header: 'Cases',
      cell: (row) =>
        (row.cases ?? [])
          .map((c) => c.accessionNumber ?? c.caseId)
          .join(', ') || '—',
    },
    {
      id: 'criteria',
      header: 'Any failed criteria',
      cell: (row) => {
        const failed = [
          row.tissueFixation === 'inadequate' && 'Fixation',
          row.processing === 'suboptimal' && 'Processing',
          row.sectionThickness === 'unacceptable' && 'Thickness',
          row.tissueFoldsTears === 'present' && 'Folds/tears',
          row.stainingQuality === 'unacceptable' && 'Staining',
          row.coverslipping === 'artefacts' && 'Coverslipping',
          row.tissueOrientation === 'unsatisfactory' && 'Orientation',
        ].filter(Boolean) as string[];
        return failed.length > 0 ? failed.join(', ') : 'None';
      },
    },
    {
      id: 'createdAt',
      header: 'Recorded',
      cell: (row) => new Date(row.createdAt).toLocaleString(),
      sortable: true,
      sortValue: (row) => row.createdAt,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isPathologist ? (
          <SlideOver open={open} onOpenChange={setOpen}>
            <SlideOverTrigger asChild>
              <Button>Record batch</Button>
            </SlideOverTrigger>
            <SlideOverContent>
              <SlideOverHeader>
                <SlideOverTitle>Record specimen-processing QC batch</SlideOverTitle>
                <SlideOverDescription>
                  One evaluation for the whole batch, plus the case it covers.
                </SlideOverDescription>
              </SlideOverHeader>
              <form
                action={formAction}
                className="flex flex-col gap-4 overflow-y-auto px-4 py-2"
              >
                {state.status === 'error' && state.formError ? (
                  <p role="alert" className="text-sm text-danger">
                    {state.formError}
                  </p>
                ) : null}
                <FormField
                  id="caseId"
                  label="Case"
                  required
                  errorText={state.fieldErrors?.['cases.0.caseId']?.[0]}
                >
                  <select
                    id="caseId"
                    name="caseId"
                    required
                    value={selectedCaseId}
                    onChange={(e) => setSelectedCaseId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {caseOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.accessionNumber} — {c.patientName}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  id="slideCount"
                  label="No. of slides"
                  required
                  errorText={state.fieldErrors?.['cases.0.slideCount']?.[0]}
                >
                  <Input type="number" name="slideCount" min={1} required />
                </FormField>
                <FormField
                  id="pathologistRemarks"
                  label="Doctor's remarks (this case)"
                  errorText={state.fieldErrors?.['cases.0.pathologistRemarks']?.[0]}
                >
                  <Input name="pathologistRemarks" />
                </FormField>
                <FormField
                  id="histoTechName"
                  label="Histo tech"
                  required
                  errorText={state.fieldErrors?.histoTechName?.[0]}
                >
                  <Input name="histoTechName" required />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    id="grossingDate"
                    label="Grossing date"
                    required
                    errorText={state.fieldErrors?.grossingDate?.[0]}
                  >
                    <Input type="date" name="grossingDate" required />
                  </FormField>
                  <FormField
                    id="slidesForwardedDate"
                    label="Date of forwarding slides"
                    required
                    errorText={state.fieldErrors?.slidesForwardedDate?.[0]}
                  >
                    <Input type="date" name="slidesForwardedDate" required />
                  </FormField>
                </div>
                <p className="text-sm font-medium text-foreground">
                  Pathologist slide evaluation criteria
                </p>
                {CRITERION_FIELDS.map((field) => (
                  <FormField
                    key={field.id}
                    id={field.id}
                    label={field.label}
                    required
                    errorText={state.fieldErrors?.[field.id]?.[0]}
                  >
                    <select
                      id={field.id}
                      name={field.id}
                      required
                      defaultValue={field.options[0][0]}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {field.options.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ))}
                <FormField id="comments" label="Comments" errorText={state.fieldErrors?.comments?.[0]}>
                  <Input name="comments" />
                </FormField>
                <FormField
                  id="correctiveAction"
                  label="Corrective action where necessary"
                  errorText={state.fieldErrors?.correctiveAction?.[0]}
                >
                  <Input name="correctiveAction" />
                </FormField>
                <SlideOverFooter className="flex-row justify-end gap-2 px-0">
                  <SlideOverClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </SlideOverClose>
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Saving…' : 'Record batch'}
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
        emptyMessage="No specimen-processing QC batches recorded yet."
      />
    </div>
  );
}
