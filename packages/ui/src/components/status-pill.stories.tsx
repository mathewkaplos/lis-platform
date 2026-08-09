import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusPill } from "./status-pill";

const meta: Meta<typeof StatusPill> = {
  title: "Primitives/StatusPill",
  component: StatusPill,
};

export default meta;
type Story = StoryObj<typeof StatusPill>;

export const Normal: Story = { args: { flag: "N" } };
export const High: Story = { args: { flag: "H" } };
export const Low: Story = { args: { flag: "L" } };
export const CriticalHigh: Story = { args: { flag: "HH" } };
export const CriticalLow: Story = { args: { flag: "LL" } };
export const Abnormal: Story = { args: { flag: "A" } };
export const Delta: Story = { args: { flag: "D" } };

export const AllFlags: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {(["N", "H", "L", "HH", "LL", "A", "D"] as const).map((flag) => (
        <StatusPill key={flag} flag={flag} />
      ))}
    </div>
  ),
};
