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
            // Tinted chip, not bare text on the card background -- text-success/text-danger
            // directly on --card fails WCAG AA contrast at this size (caught by TASK-037's CI
            // a11y check, real finding not a hypothetical). Same treatment StatusPill's H/L
            // variant already uses successfully.
            <span
              className={cn(
                "inline-flex w-fit items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                tone === "positive"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/30 bg-danger/10 text-danger",
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
