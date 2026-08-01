"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Checkbox } from "./checkbox";
import { cn } from "../lib/cn";

// Dense, sortable, multi-select data table per Stitch Prompt Library §0/§1 Pattern A.
// Scope note: this first pass covers sorting, row selection, sticky header, and keyboard row
// activation -- pagination/infinite scroll, column show/hide/reorder/resize, and the bulk-action
// bar are real Pattern A requirements not yet built here (no task in this proposal's scope
// covers them; revisit when a screen actually needs them).
export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  selectedRowIds?: string[];
  onSelectedRowIdsChange?: (ids: string[]) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
}

type SortState = { columnId: string; direction: "asc" | "desc" } | null;

function DataTable<T>({
  columns,
  data,
  getRowId,
  selectedRowIds,
  onSelectedRowIdsChange,
  onRowClick,
  emptyMessage = "No records found.",
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<SortState>(null);
  const selectable = Boolean(onSelectedRowIdsChange);

  const sortedData = React.useMemo(() => {
    if (!sort) return data;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue) return data;
    const sortValue = column.sortValue;
    return [...data].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av < bv) return sort.direction === "asc" ? -1 : 1;
      if (av > bv) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sort, columns]);

  function toggleSort(columnId: string) {
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: "asc" };
      if (current.direction === "asc") return { columnId, direction: "desc" };
      return null;
    });
  }

  function toggleRow(id: string) {
    if (!onSelectedRowIdsChange || !selectedRowIds) return;
    onSelectedRowIdsChange(
      selectedRowIds.includes(id)
        ? selectedRowIds.filter((rowId) => rowId !== id)
        : [...selectedRowIds, id],
    );
  }

  function toggleAll() {
    if (!onSelectedRowIdsChange) return;
    const allIds = sortedData.map(getRowId);
    const allSelected = allIds.every((id) => selectedRowIds?.includes(id));
    onSelectedRowIdsChange(allSelected ? [] : allIds);
  }

  const allSelected =
    selectable &&
    sortedData.length > 0 &&
    sortedData.every((row) => selectedRowIds?.includes(getRowId(row)));

  return (
    <div
      data-slot="data-table"
      className={cn("relative w-full overflow-auto rounded-md border border-border", className)}
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface">
          <TableRow>
            {selectable ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all rows"
                />
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead
                key={column.id}
                className={column.align === "right" ? "text-right" : undefined}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(column.id)}
                    className="inline-flex items-center gap-1 rounded-xs font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {column.header}
                    {sort?.columnId === column.id ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="size-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((row) => {
              const id = getRowId(row);
              const selected = Boolean(selectedRowIds?.includes(id));
              return (
                <TableRow
                  key={id}
                  data-state={selected ? "selected" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  className={cn(
                    onRowClick &&
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {selectable ? (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleRow(id)}
                        aria-label="Select row"
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={column.align === "right" ? "text-right tabular-nums" : undefined}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable };
