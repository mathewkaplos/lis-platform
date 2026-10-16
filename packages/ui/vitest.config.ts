import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// packages/ui's first test config (UI-013, docs/ui-review/03-roadmap.md). Needs a real DOM
// (jsdom) and React rendering, unlike apps/web's existing vitest.config.ts (environment: 'node',
// no component rendering) -- component tests are new to this monorepo, not just to this package.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.spec.tsx"],
    exclude: ["**/node_modules/**", "src/**/*.stories.tsx"],
  },
});
