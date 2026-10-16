import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogOut, Settings, User } from "lucide-react";

import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const meta: Meta<typeof DropdownMenu> = {
  title: "Primitives/DropdownMenu",
  component: DropdownMenu,
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

function MenuContent() {
  return (
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>My account</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>
        <User className="size-4" />
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem>
        <Settings className="size-4" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive">
        <LogOut className="size-4" />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export const Closed: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">User menu</Button>
      </DropdownMenuTrigger>
      <MenuContent />
    </DropdownMenu>
  ),
};

// UI-014 (docs/ui-review/03-roadmap.md): defaultOpen so axe scans the actual rendered menu
// content (DropdownMenuContent's items, labels, separators), not just the closed trigger button
// -- the trigger alone was already implicitly covered elsewhere (e.g. as a plain Button), the
// real, previously-untested surface is what's inside the portal once it's open.
export const Open: Story = {
  // Radix DropdownMenu defaults to modal=true (matches every real call site in this app --
  // top-bar.tsx, locale-select.tsx -- neither overrides it), which marks everything outside the
  // open menu's content aria-hidden, including the trigger's own container. axe's
  // `aria-hidden-focus` rule flags this as a potential violation (an aria-hidden subtree
  // containing a focusable element) -- correct as a static DOM check, but verified a false
  // positive here: a real Playwright run against this exact story (focus the open menu, press
  // Tab/Shift+Tab 5x each) showed focus staying inside the menu's FocusScope-trapped content the
  // entire time, never once reaching the aria-hidden trigger; Escape correctly returns focus to
  // the trigger only after the menu closes (and aria-hidden is removed). The trigger is
  // genuinely unreachable by keyboard while aria-hidden, axe just can't know that from DOM
  // structure alone. Disabling only this one rule, only on this one story -- not globally, and
  // not by changing `modal` (that's a real behavior trade-off, not a false-positive fix).
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">User menu</Button>
      </DropdownMenuTrigger>
      <MenuContent />
    </DropdownMenu>
  ),
};
