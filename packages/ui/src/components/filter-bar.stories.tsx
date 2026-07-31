import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FilterBar, type FilterChip } from "./filter-bar";

const meta: Meta<typeof FilterBar> = {
  title: "Primitives/FilterBar",
  component: FilterBar,
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Interactive: Story = {
  render: () => {
    const [filters, setFilters] = React.useState<FilterChip[]>([
      { id: "priority", label: "Priority: STAT" },
      { id: "discipline", label: "Discipline: Chemistry" },
    ]);
    return (
      <FilterBar
        filters={filters}
        onRemove={(id) => setFilters((current) => current.filter((f) => f.id !== id))}
        onClearAll={() => setFilters([])}
      />
    );
  },
};

export const Empty: Story = {
  args: { filters: [], onRemove: () => {} },
};
