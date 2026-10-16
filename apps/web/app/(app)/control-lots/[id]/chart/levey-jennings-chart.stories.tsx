import type { Meta, StoryObj } from "@storybook/react-vite";

import { LeveyJenningsChart, type ChartPoint } from "./levey-jennings-chart";

const meta: Meta<typeof LeveyJenningsChart> = {
  title: "AppComponents/LeveyJenningsChart",
  component: LeveyJenningsChart,
};

export default meta;
type Story = StoryObj<typeof LeveyJenningsChart>;

const TARGET_MEAN = 100;
const TARGET_SD = 5;

function pointAt(id: string, zScore: number, violations: ChartPoint["violations"] = []): ChartPoint {
  const createdAt = new Date(2026, 9, 1 + Number(id)).toISOString();
  return {
    id,
    value: TARGET_MEAN + zScore * TARGET_SD,
    zScore,
    producedAt: createdAt,
    createdAt,
    violations,
  };
}

// UI-009 (docs/ui-review/03-roadmap.md): includes at least one warning point and one rejection
// point side by side, specifically so severity's shape-not-just-color distinction (circle /
// triangle / diamond) is visible in one render, not split across separate stories.
const POINTS: ChartPoint[] = [
  pointAt("1", 0.3),
  pointAt("2", 1.8, [{ ruleCode: "1_2s", severity: "warning" }]),
  pointAt("3", 0.5),
  pointAt("4", -3.2, [{ ruleCode: "1_3s", severity: "rejection" }]),
  pointAt("5", 0.1),
  pointAt("6", -2.3, [{ ruleCode: "2_2s", severity: "warning" }]),
  pointAt("7", -0.4),
];

export const WithWarningAndRejection: Story = {
  args: {
    targetMean: TARGET_MEAN,
    targetSd: TARGET_SD,
    points: POINTS,
  },
};

export const Empty: Story = {
  args: {
    targetMean: TARGET_MEAN,
    targetSd: TARGET_SD,
    points: [],
  },
};
