import * as React from "react";
import { X } from "lucide-react";

import { Button } from "./button";
import { cn } from "../lib/cn";

export interface FilterChip {
  id: string;
  label: string;
}

export interface FilterBarProps {
  filters: FilterChip[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  // Slot for a "Filters" drawer trigger (§0: "a 'Filters' drawer for advanced/faceted
  // filtering") -- left as a slot rather than building a drawer, no drawer primitive approved
  // for this task.
  filtersTrigger?: React.ReactNode;
  className?: string;
}

function FilterBar({
  filters,
  onRemove,
  onClearAll,
  filtersTrigger,
  className,
}: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      role="group"
      aria-label="Active filters"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {filtersTrigger}
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground"
        >
          {filter.label}
          <button
            type="button"
            onClick={() => onRemove(filter.id)}
            aria-label={`Remove filter ${filter.label}`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {filters.length > 0 && onClearAll ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
      ) : null}
    </div>
  );
}

export { FilterBar };
