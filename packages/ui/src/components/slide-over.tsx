import * as React from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { cn } from "../lib/cn";

// Thin wrapper over shadcn's Sheet, defaulting to a right-side panel at the ~480-640px width
// Stitch Prompt Library §0 specifies for slide-over panels (Sheet's own default is a narrower
// 384px, sized for a generic app rather than this product's detail/quick-edit use).
export type SlideOverProps = React.ComponentProps<typeof Sheet>;

function SlideOver(props: SlideOverProps) {
  return <Sheet {...props} />;
}

function SlideOverContent({
  className,
  ...props
}: React.ComponentProps<typeof SheetContent>) {
  return (
    <SheetContent side="right" className={cn("w-full sm:max-w-[560px]", className)} {...props} />
  );
}

export {
  SlideOver,
  SlideOverContent,
  SheetTrigger as SlideOverTrigger,
  SheetClose as SlideOverClose,
  SheetHeader as SlideOverHeader,
  SheetFooter as SlideOverFooter,
  SheetTitle as SlideOverTitle,
  SheetDescription as SlideOverDescription,
};
