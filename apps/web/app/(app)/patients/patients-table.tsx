'use client';

import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@lis/ui';
import { ageOf, SEX_LABEL } from './_lib/patient-display';

export interface PatientRow {
  id: string;
  mrn: string;
  nationalId: string | null;
  firstName: string;
  lastName: string;
  sex: string;
  birthDate: string | null;
}

/**
 * TASK-041 (FEAT-011): thin client island around the shared `DataTable`
 * primitive -- exists only to own row-click navigation (`useRouter` is
 * client-only), since the search page itself is a Server Component and
 * can't pass a plain closure across the server/client boundary.
 */
export function PatientsTable({ rows }: { rows: PatientRow[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={[
        {
          id: 'mrn',
          header: 'MRN',
          cell: (row) => <span className="font-mono">{row.mrn}</span>,
        },
        {
          id: 'name',
          header: 'Name',
          cell: (row) => `${row.firstName} ${row.lastName}`,
          sortable: true,
          sortValue: (row) => `${row.lastName} ${row.firstName}`,
        },
        {
          id: 'sex',
          header: 'Sex',
          cell: (row) => <Badge variant="outline">{SEX_LABEL[row.sex] ?? row.sex}</Badge>,
        },
        { id: 'age', header: 'Age', cell: (row) => ageOf(row.birthDate), align: 'right' },
        {
          id: 'nationalId',
          header: 'National ID',
          cell: (row) => row.nationalId ?? '—',
        },
      ]}
      data={rows}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/patients/${row.id}`)}
      emptyMessage="No patients match — register a new patient."
    />
  );
}
