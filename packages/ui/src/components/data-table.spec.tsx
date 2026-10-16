import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTable } from "./data-table";

// UI-013 (docs/ui-review/03-roadmap.md): data-table.tsx:159-164's keyboard row-activation
// (Enter/Space -> onRowClick) is exactly the kind of logic a broken-handler regression wouldn't
// show up as an axe violation for -- the DOM stays structurally valid, the behavior just stops
// working. This is the real results-grid/worklist keyboard-only-completion path this project's
// own lis-ui skill (§9) says every change needs verified.

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "1", name: "Alice" },
  { id: "2", name: "Bob" },
];
const columns = [{ id: "name", header: "Name", cell: (row: Row) => row.name }];

describe("DataTable keyboard row activation", () => {
  it("activates a row on Enter when onRowClick is provided", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />);

    const row = screen.getByText("Alice").closest("tr")!;
    row.focus();
    await user.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[0]);
  });

  it("activates a row on Space when onRowClick is provided", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />);

    const row = screen.getByText("Bob").closest("tr")!;
    row.focus();
    await user.keyboard(" ");

    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });

  it("makes rows focusable (tabIndex=0) only when onRowClick is provided", () => {
    const { rerender } = render(
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={() => {}} />,
    );
    expect(screen.getByText("Alice").closest("tr")).toHaveAttribute("tabindex", "0");

    rerender(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    expect(screen.getByText("Alice").closest("tr")).not.toHaveAttribute("tabindex");
  });

  it("does not activate on an unrelated key (e.g. ArrowDown)", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />);

    const row = screen.getByText("Alice").closest("tr")!;
    row.focus();
    await user.keyboard("{ArrowDown}");

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
