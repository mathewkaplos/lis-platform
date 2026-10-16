import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta: Meta<typeof Card> = {
  title: "Primitives/Card",
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>Pending</CardTitle>
        <CardDescription>Orders waiting for collection or results.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>18</p>
      </CardContent>
    </Card>
  ),
};

export const WithActionAndFooter: Story = {
  render: () => (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>QC violation</CardTitle>
        <CardDescription>Westgard 1-3s, Chemistry Level 2</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            Resolve
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>Flagged 2026-10-16 09:12</p>
      </CardContent>
      <CardFooter>
        <p>Control lot: CL-2041</p>
      </CardFooter>
    </Card>
  ),
};
