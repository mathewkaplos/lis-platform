import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DataTable, type DataTableColumn } from "./data-table";
import { StatusPill, type ResultFlag } from "./status-pill";

interface Row {
  id: string;
  accession: string;
  patient: string;
  analyte: string;
  value: number;
  unit: string;
  flag: ResultFlag;
}

const rows: Row[] = [
  { id: "1", accession: "A-2026-004182", patient: "Jane Doe", analyte: "Potassium", value: 4.1, unit: "mmol/L", flag: "N" },
  { id: "2", accession: "A-2026-004183", patient: "John Smith", analyte: "Potassium", value: 6.2, unit: "mmol/L", flag: "HH" },
  { id: "3", accession: "A-2026-004184", patient: "Amara Okafor", analyte: "Potassium", value: 3.0, unit: "mmol/L", flag: "L" },
  { id: "4", accession: "A-2026-004185", patient: "Liu Wei", analyte: "Potassium", value: 5.4, unit: "mmol/L", flag: "H" },
];

const columns: DataTableColumn<Row>[] = [
  { id: "accession", header: "Accession", cell: (r) => <span className="font-mono">{r.accession}</span>, sortable: true, sortValue: (r) => r.accession },
  { id: "patient", header: "Patient", cell: (r) => r.patient, sortable: true, sortValue: (r) => r.patient },
  { id: "analyte", header: "Analyte", cell: (r) => r.analyte },
  {
    id: "value",
    header: "Value",
    cell: (r) => `${r.value} ${r.unit}`,
    align: "right",
    sortable: true,
    sortValue: (r) => r.value,
  },
  { id: "flag", header: "Flag", cell: (r) => <StatusPill flag={r.flag} /> },
];

const meta: Meta<typeof DataTable> = {
  title: "Primitives/DataTable",
};

export default meta;
type Story = StoryObj<typeof DataTable<Row>>;

export const Default: Story = {
  render: () => <DataTable columns={columns} data={rows} getRowId={(r) => r.id} />,
};

export const Selectable: Story = {
  render: () => {
    const [selected, setSelected] = React.useState<string[]>([]);
    return (
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        selectedRowIds={selected}
        onSelectedRowIdsChange={setSelected}
        onRowClick={(row) => console.log("open", row.accession)}
      />
    );
  },
};

export const Empty: Story = {
  render: () => <DataTable columns={columns} data={[]} getRowId={(r) => r.id} />,
};
