import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormField } from "./form-field";
import { Input } from "./input";

const meta: Meta<typeof FormField> = {
  title: "Primitives/FormField",
  component: FormField,
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: {
    id: "patient-name",
    label: "Patient name",
  },
  render: (args) => (
    <FormField {...args}>
      <Input placeholder="Jane Doe" />
    </FormField>
  ),
};

export const Required: Story = {
  args: {
    id: "mrn",
    label: "MRN",
    required: true,
    helperText: "Medical record number, as printed on the patient's card.",
  },
  render: (args) => (
    <FormField {...args}>
      <Input placeholder="A-2026-004182" />
    </FormField>
  ),
};

export const WithError: Story = {
  args: {
    id: "email",
    label: "Email",
    required: true,
    errorText: "Enter a valid email address.",
  },
  render: (args) => (
    <FormField {...args}>
      <Input defaultValue="not-an-email" aria-invalid />
    </FormField>
  ),
};
