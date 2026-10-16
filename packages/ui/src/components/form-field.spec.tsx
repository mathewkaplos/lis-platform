import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FormField } from "./form-field";
import { Input } from "./input";

// UI-013 (docs/ui-review/03-roadmap.md): FormField's cloneElement-based aria-wiring
// (form-field.tsx:42-47) is the one piece of this package's logic that axe's DOM-scan alone
// can't fully guard -- a broken wiring produces a structurally valid but semantically wrong
// DOM (e.g. aria-describedby pointing at nothing), which axe won't always flag.

describe("FormField", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <FormField id="patient-name" label="Patient name">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Patient name");
    expect(input).toHaveAttribute("id", "patient-name");
  });

  it("injects aria-required only when required is set", () => {
    const { rerender } = render(
      <FormField id="mrn" label="MRN">
        <Input />
      </FormField>,
    );
    expect(screen.getByRole("textbox", { name: "MRN" })).not.toHaveAttribute("aria-required");

    rerender(
      <FormField id="mrn" label="MRN" required>
        <Input />
      </FormField>,
    );
    // getByRole's accessible-name computation (unlike getByLabelText's default exact-string
    // match against raw textContent) correctly excludes the aria-hidden asterisk span below --
    // this query only succeeds if that exclusion is actually working, which is the real thing
    // worth asserting here.
    expect(screen.getByRole("textbox", { name: "MRN" })).toHaveAttribute("aria-required", "true");
  });

  it("injects aria-invalid and associates the error text via aria-describedby, with role=alert", () => {
    render(
      <FormField id="email" label="Email" errorText="Enter a valid email address.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBe("email-error");

    const error = screen.getByRole("alert");
    expect(error).toHaveAttribute("id", "email-error");
    expect(error).toHaveTextContent("Enter a valid email address.");
    expect(describedBy).toBe(error.id);
  });

  it("does not set aria-invalid when there is no error, and associates helper text instead", () => {
    render(
      <FormField id="phone" label="Phone" helperText="Include country code.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Phone");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.getAttribute("aria-describedby")).toBe("phone-helper");
    expect(screen.getByText("Include country code.")).toHaveAttribute("id", "phone-helper");
  });

  it("renders the required asterisk as aria-hidden (decorative, not a second accessible-name source)", () => {
    render(
      <FormField id="mrn" label="MRN" required>
        <Input />
      </FormField>,
    );
    // The real accessible name must be exactly "MRN", not "MRN *" -- getByRole's name computation
    // excludes aria-hidden content, so this only passes if the asterisk is genuinely decorative.
    expect(screen.getByRole("textbox", { name: "MRN" })).toBeInTheDocument();
  });
});
