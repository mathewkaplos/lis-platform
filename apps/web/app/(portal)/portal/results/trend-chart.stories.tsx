import type { Meta, StoryObj } from "@storybook/react-vite";

import { TrendChart, type TrendPoint } from "./trend-chart";

const meta: Meta<typeof TrendChart> = {
  title: "AppComponents/TrendChart",
  component: TrendChart,
};

export default meta;
type Story = StoryObj<typeof TrendChart>;

function pointAt(id: string, value: string, flags: string[] = [], isCritical = false): TrendPoint {
  return {
    observationId: id,
    producedAt: new Date(2026, 9, 1 + Number(id)).toLocaleDateString(),
    value,
    unit: "mmol/L",
    flags,
    referenceRangeText: "3.5 - 5.0",
    isCritical,
  };
}

// UI-020 (docs/ui-review/03-roadmap.md): includes a normal, a warning (H), and a critical (HH)
// point in one render -- the same reasoning as levey-jennings-chart.stories.tsx's own sample
// data, so storybook-a11y and a manual grayscale check both exercise all three marker colors.
const POINTS: TrendPoint[] = [
  pointAt("1", "4.1"),
  pointAt("2", "4.3"),
  pointAt("3", "5.4", ["H"]),
  pointAt("4", "4.5"),
  pointAt("5", "6.8", ["HH"], true),
];

export const WithNormalWarningAndCritical: Story = {
  args: {
    analyteDisplay: "Potassium",
    points: POINTS,
  },
};

export const Empty: Story = {
  args: {
    analyteDisplay: "Potassium",
    points: [],
  },
};
