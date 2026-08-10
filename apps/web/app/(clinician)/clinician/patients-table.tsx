'use client';

import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@lis/ui';

export interface ClinicianPatientRow {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

/**
 * FEAT-038: `DataTable`'s `columns` prop takes plain closures (`cell`/
 * `sortValue`), which aren't serializable across the Server->Client
 * component boundary -- found for real building this dashboard, not
 * hypothetical: a Server Component building the `columns` array and passing
 * it straight to `DataTable` (a Client Component) failed at runtime with
 * "Functions cannot be passed directly to Client Components." Same fix as
 * this repo's own existing precedent (`(app)/orders/orders-table.tsx`): the
 * column definitions live inside a Client Component that takes only
 * plain, JSON-serializable row data as props.
 */
export function ClinicianPatientsTable({ patients }: { patients: ClinicianPatientRow[] }) {
  const columns: DataTableColumn<ClinicianPatientRow>[] = [
    {
      id: 'name',
      header: 'Patient',
      cell: (p) => `${p.firstName} ${p.lastName}`,
      sortable: true,
      sortValue: (p) => `${p.lastName} ${p.firstName}`,
    },
    { id: 'mrn', header: 'MRN', cell: (p) => <span className="font-mono">{p.mrn}</span> },
    {
      id: 'actions',
      header: '',
      cell: (p) => (
        <div className="flex gap-4">
          <Link href={`/clinician/patients/${p.id}/results`} className="text-sm text-primary underline">
            View results
          </Link>
          <Link
            href={`/clinician/orders/new?patientId=${p.id}`}
            className="text-sm text-primary underline"
          >
            Place an order
          </Link>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={patients}
      getRowId={(p) => p.id}
      emptyMessage="No patients are currently assigned to you."
    />
  );
}
