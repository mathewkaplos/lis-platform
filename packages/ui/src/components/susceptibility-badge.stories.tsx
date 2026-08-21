import type { Meta, StoryObj } from "@storybook/react-vite";

import { SusceptibilityBadge } from "./susceptibility-badge";

const meta: Meta<typeof SusceptibilityBadge> = {
  title: "Primitives/SusceptibilityBadge",
  component: SusceptibilityBadge,
};

export default meta;
type Story = StoryObj<typeof SusceptibilityBadge>;

export const Susceptible: Story = { args: { interpretation: "S" } };
export const Intermediate: Story = { args: { interpretation: "I" } };
export const Resistant: Story = { args: { interpretation: "R" } };

export const AllInterpretations: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {(["S", "I", "R"] as const).map((interpretation) => (
        <SusceptibilityBadge key={interpretation} interpretation={interpretation} />
      ))}
    </div>
  ),
};
