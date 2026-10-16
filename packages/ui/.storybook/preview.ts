import type { Preview, Decorator } from "@storybook/react-vite";
import React from "react";

// Imports apps/web's globals.css directly -- it's the actual CSS runtime source of truth for
// the design tokens (docs/design.md + packages/ui/tokens.ts are the documentation/TS mirrors,
// kept in sync by hand per TASK-034). Worth revisiting if/when the token CSS ever moves into
// packages/ui itself (the more conventional direction for a shared package to not depend on
// one of its own consumer apps) -- out of scope for this task's minimal scaffold.
import "../../../apps/web/app/globals.css";

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme ?? "light";
  // UI-021 (docs/ui-review/03-roadmap.md): apps/web/app/globals.css's dark-mode tokens are
  // scoped to `:root[data-theme="dark"]` (confirmed by reading that file) -- `:root` means the
  // <html> element specifically, so setting `data-theme` on this wrapper <div> (previously the
  // only place it was set) never actually matched that selector. Every CSS custom property
  // (--chart-in-control, --surface, etc.) silently stayed at its light-mode value regardless of
  // the toolbar's Light/Dark toggle, confirmed directly via getComputedStyle. Mirrors the real
  // app's own theme-provider convention of setting the attribute on the document root.
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  return React.createElement(
    "div",
    { "data-theme": theme, style: { background: "var(--background)", padding: "1rem" } },
    React.createElement(Story),
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Light / dark theme",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
