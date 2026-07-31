import * as React from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "../lib/cn";

// Clinical result flags. Per Stitch Prompt Library §0: never encode result status with color
// alone -- always paired with a letter flag and an icon.
export type ResultFlag = "N" | "H" | "L" | "HH" | "LL" | "A";

const FLAG_META: Record<
  ResultFlag,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }> | null;
    className: string;
  }
> = {
  N: {
    label: "Normal",
    icon: null,
    className: "border-transparent bg-transparent text-foreground",
  },
  H: {
    label: "High",
    icon: ArrowUp,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  L: {
    label: "Low",
    icon: ArrowDown,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  HH: {
    label: "Critical high",
    icon: ArrowUp,
    className: "border-transparent bg-danger text-white",
  },
  LL: {
    label: "Critical low",
    icon: ArrowDown,
    className: "border-transparent bg-danger text-white",
  },
  A: {
    label: "Abnormal",
    icon: AlertTriangle,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  flag: ResultFlag;
}

function StatusPill({ flag, className, ...props }: StatusPillProps) {
  const meta = FLAG_META[flag];
  const Icon = meta.icon;
  const critical = flag === "HH" || flag === "LL";

  return (
    <span
      data-slot="status-pill"
      data-flag={flag}
      role="status"
      aria-label={meta.label}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        meta.className,
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
      {flag}
      {critical ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block size-1.5 rounded-full bg-white"
        />
      ) : null}
    </span>
  );
}

export { StatusPill };
