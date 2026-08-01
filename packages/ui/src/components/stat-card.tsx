import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Card, CardContent, CardHeader } from "./card";
import { cn } from "../lib/cn";

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: {
    value: string;
    direction: "up" | "down";
    tone?: "positive" | "negative";
  };
  sparkline?: React.ReactNode;
  className?: string;
}

function StatCard({ label, value, delta, sparkline, className }: StatCardProps) {
  const tone = delta?.tone ?? (delta?.direction === "up" ? "positive" : "negative");

  return (
    <Card data-slot="stat-card" className={cn("gap-2", className)}>
      <CardHeader>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          {delta ? (
            // Solid background + white text, not colored text/tinted chips -- caught by
            // TASK-037's CI a11y check (real finding, not hypothetical): neither
            // text-success/text-danger as foreground nor as a light tint background meets
            // WCAG AA at this size against --success (#16A34A) specifically -- its own
            // contrast against white is ~3.29:1, below the 4.5:1 required (confirmed by
            // hand, matches the CI failure). --danger (#DC2626) is dark enough on its own
            // (~4.83:1) and reuses the exact `bg-danger text-white` treatment StatusPill's
            // HH/LL already proved passes in this same CI run. --success has no
            // AA-passing text/background use at this size as specified in Stitch §0 --
            // #15803D below is a deliberately minimal, component-local darker shade for
            // this one usage, not a change to the canonical --success token (docs/design.md
            // unchanged; worth a broader look at whether other --success text usages need
            // the same treatment, not done here).
            <span
              className={cn(
                "inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums text-white",
                tone === "positive" ? "bg-[#15803D]" : "bg-danger",
              )}
            >
              {delta.direction === "up" ? (
                <ArrowUp className="size-3" aria-hidden="true" />
              ) : (
                <ArrowDown className="size-3" aria-hidden="true" />
              )}
              {delta.value}
            </span>
          ) : null}
        </div>
        {sparkline ? <div className="h-8 w-20">{sparkline}</div> : null}
      </CardContent>
    </Card>
  );
}

export { StatCard };
