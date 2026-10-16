import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormField } from "./form-field";
import { Select } from "./select";

const meta: Meta<typeof Select> = {
  title: "Primitives/Select",
  component: Select,
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: () => (
    <Select aria-label="Priority" defaultValue="">
      <option value="" disabled>
        Any
      </option>
      <option value="routine">Routine</option>
      <option value="stat">STAT</option>
    </Select>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Select aria-label="Priority" disabled defaultValue="routine">
      <option value="routine">Routine</option>
      <option value="stat">STAT</option>
    </Select>
  ),
};

export const InFormField: Story = {
  render: () => (
    <FormField id="priority" label="Priority">
      <Select defaultValue="">
        <option value="" disabled>
          Any
        </option>
        <option value="routine">Routine</option>
        <option value="stat">STAT</option>
      </Select>
    </FormField>
  ),
};
