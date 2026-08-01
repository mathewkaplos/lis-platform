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
