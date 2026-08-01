import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatCard } from "./stat-card";

const meta: Meta<typeof StatCard> = {
  title: "Primitives/StatCard",
  component: StatCard,
};

export default meta;
type Story = StoryObj<typeof StatCard>;

export const Default: Story = {
  args: {
    label: "Active samples in lab",
    value: 128,
  },
};

export const WithPositiveDelta: Story = {
  args: {
    label: "Average TAT (SLA-met %)",
    value: "96%",
    delta: { value: "+2.1%", direction: "up" },
  },
};

export const WithNegativeDelta: Story = {
  args: {
    label: "Critical results open",
    value: 3,
    delta: { value: "+3", direction: "up", tone: "negative" },
  },
};

export const Row: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
      <StatCard label="Total orders today" value={412} delta={{ value: "+8%", direction: "up" }} />
      <StatCard label="Average TAT" value="1h 12m" />
      <StatCard
        label="Critical results open"
        value={3}
        delta={{ value: "+3", direction: "up", tone: "negative" }}
      />
    </div>
  ),
};
