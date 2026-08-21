import * as React from "react";

import { cn } from "../lib/cn";

// Issue #694. A real, separate mechanism from `StatusPill`/`FLAG_META` --
// not an extension of it. `StatusPill`'s own `ResultFlag` alphabet reserves
// `R` for a future *reflex* flag (`observation.flags`'s own schema comment,
// `packages/db/src/schema/observation.ts`), a different concept entirely
// from an antibiogram's S/I/R *interpretation*. Conflating the two would be
// a real semantic collision, not just a naming clash. Follows the same
// accessibility discipline `frontend-design` Skill entry #1 states (never
// encode clinical significance by color alone) without reusing that
// component's specific flag set.
export type SusceptibilityInterpretation = "S" | "I" | "R";

const INTERPRETATION_META: Record<
  SusceptibilityInterpretation,
  { label: string; className: string }
> = {
  S: {
    label: "Susceptible",
    className: "border-transparent bg-transparent text-foreground",
  },
  I: {
    label: "Intermediate",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  R: {
    label: "Resistant",
    className: "border-transparent bg-danger text-white",
  },
};

export interface SusceptibilityBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  interpretation: SusceptibilityInterpretation;
}

function SusceptibilityBadge({
  interpretation,
  className,
  ...props
}: SusceptibilityBadgeProps) {
  const meta = INTERPRETATION_META[interpretation];

  return (
    <span
      data-slot="susceptibility-badge"
      data-interpretation={interpretation}
      role="status"
      aria-label={meta.label}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        meta.className,
        className,
      )}
      {...props}
    >
      {interpretation}
      {interpretation === "R" ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block size-1.5 rounded-full bg-white"
        />
      ) : null}
    </span>
  );
}

export { SusceptibilityBadge };
