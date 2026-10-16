import * as React from "react"

import { cn } from "../lib/cn"

// UI-002 (docs/ui-review/03-roadmap.md): packages/ui had no Select primitive, so ~15 files
// across apps/web independently copy-pasted the same raw <select> className string (closest
// match: Input's own treatment, minus disabled/aria-invalid handling). A native <select>, not a
// Radix-based custom dropdown -- matches what every one of those call sites already uses, so
// migrating them (UI-003) is a visual no-op, not a redesign. Mirrors input.tsx's own structure
// line for line, plus the disabled/aria-invalid states the raw copies were missing.
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
