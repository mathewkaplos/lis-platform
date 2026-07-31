import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  SlideOver,
  SlideOverContent,
  SlideOverDescription,
  SlideOverHeader,
  SlideOverTitle,
  SlideOverTrigger,
} from "./slide-over";
import { Button } from "./button";

const meta: Meta<typeof SlideOver> = {
  title: "Primitives/SlideOver",
};

export default meta;
type Story = StoryObj<typeof SlideOver>;

export const Default: Story = {
  render: () => (
    <SlideOver>
      <SlideOverTrigger asChild>
        <Button>Open patient detail</Button>
      </SlideOverTrigger>
      <SlideOverContent>
        <SlideOverHeader>
          <SlideOverTitle>Jane Doe — A-2026-004182</SlideOverTitle>
          <SlideOverDescription>Quick view, without leaving the worklist.</SlideOverDescription>
        </SlideOverHeader>
      </SlideOverContent>
    </SlideOver>
  ),
};
