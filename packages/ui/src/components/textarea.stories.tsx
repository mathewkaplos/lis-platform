import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormField } from "./form-field";
import { Textarea } from "./textarea";

const meta: Meta<typeof Textarea> = {
  title: "Primitives/Textarea",
  component: Textarea,
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  render: () => <Textarea aria-label="Reason for amendment" placeholder="Reason for amendment" rows={3} />,
};

export const Disabled: Story = {
  render: () => (
    <Textarea
      aria-label="Reason for amendment"
      disabled
      defaultValue="Locked while under review."
      rows={3}
    />
  ),
};

export const InFormField: Story = {
  render: () => (
    <FormField id="amend-reason" label="Reason for amendment" required>
      <Textarea rows={3} />
    </FormField>
  ),
};
