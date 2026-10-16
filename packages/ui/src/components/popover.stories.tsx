import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

const meta: Meta<typeof Popover> = {
  title: "Primitives/Popover",
  component: Popover,
};

export default meta;
type Story = StoryObj<typeof Popover>;

function Content() {
  return (
    <PopoverContent>
      <PopoverHeader>
        <PopoverTitle>Reference range</PopoverTitle>
        <PopoverDescription>
          3.5 - 5.0 mmol/L for adults, per the current reference-range version.
        </PopoverDescription>
      </PopoverHeader>
    </PopoverContent>
  );
}

export const Closed: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Potassium</Button>
      </PopoverTrigger>
      <Content />
    </Popover>
  ),
};

// UI-014 (docs/ui-review/03-roadmap.md): defaultOpen so axe scans the actual rendered popover
// content, not just the closed trigger -- same reasoning as dropdown-menu.stories.tsx's Open
// story.
export const Open: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Potassium</Button>
      </PopoverTrigger>
      <Content />
    </Popover>
  ),
};
