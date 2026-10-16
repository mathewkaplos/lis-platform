import * as React from "react"

import { cn } from "../lib/cn"

// UI-002 (docs/ui-review/03-roadmap.md): same reasoning as select.tsx -- packages/ui had no
// Textarea primitive, so every multi-line field (amend reason, gross description, narrative,
// etc.) copy-pasted the same raw <textarea> className. Mirrors input.tsx's own treatment, using
// a min-height instead of a fixed h-9 (a textarea's own `rows` prop already sets its intrinsic
// height; forcing h-9 would fight that).
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
