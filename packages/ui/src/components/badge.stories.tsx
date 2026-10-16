import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Badge",
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { children: "Default" } };
export const Secondary: Story = { args: { variant: "secondary", children: "Secondary" } };
export const Destructive: Story = { args: { variant: "destructive", children: "STAT" } };
export const Outline: Story = { args: { variant: "outline", children: "Routine" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Ghost" } };
export const Link: Story = { args: { variant: "link", children: "Link" } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">STAT</Badge>
      <Badge variant="outline">Routine</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
    </div>
  ),
};
