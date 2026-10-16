import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    "../src/components/**/*.stories.tsx",
    // UI-009 (docs/ui-review/03-roadmap.md): the Levey-Jennings chart lives in apps/web, not
    // packages/ui -- scoped narrowly to just this one component's own directory, not a general
    // widening to all of apps/web, since this Storybook instance is otherwise specifically
    // packages/ui's own design-system build (TASK-035/037's original scope).
    // (app) and [id] are literal Next.js route-group/dynamic-route folder names, not glob
    // syntax (parens/brackets are extglob/character-class tokens to fast-glob, Vite's glob
    // engine). Backslash-escaping them matched directly under fast-glob in isolation but not
    // through Storybook's own glob resolution (untraced further) -- **/ avoids the ambiguous
    // segments entirely instead, confirmed working both in isolation and through a real
    // Storybook build.
    "../../../apps/web/**/control-lots/**/*.stories.tsx",
    // UI-020 (docs/ui-review/03-roadmap.md): same reasoning and same **/ pattern as the
    // control-lots entry above -- (portal) is a route-group folder name, not glob syntax.
    "../../../apps/web/**/portal/results/*.stories.tsx",
  ],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite");
    const { default: tailwindcss } = await import("@tailwindcss/vite");
    return mergeConfig(config, {
      plugins: [tailwindcss()],
    });
  },
};

export default config;
