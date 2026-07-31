import * as React from "react";

import { Label } from "./label";
import { cn } from "../lib/cn";

export interface FormFieldProps {
  id: string;
  label: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  className?: string;
  // A single form control (e.g. <Input />) -- id/aria-* are injected onto it, per §0's rule
  // that labels always sit above inputs, never placeholder-only.
  children: React.ReactElement;
}

function FormField({
  id,
  label,
  helperText,
  errorText,
  required,
  className,
  children,
}: FormFieldProps) {
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="form-field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": errorText ? true : undefined,
        "aria-required": required || undefined,
      } as React.HTMLAttributes<HTMLElement>)}
      {errorText ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {errorText}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export { FormField };
