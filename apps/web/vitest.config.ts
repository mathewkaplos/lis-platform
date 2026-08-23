import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// apps/web's first test config -- mirrors apps/api's own vitest.config.ts
// shape (plain node environment, no React rendering needed for this suite's
// server-side auth logic; a React/jsdom environment can be added later if a
// component test genuinely needs one).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['**/*.spec.ts'],
    // e2e/ holds real-browser Playwright specs (its own `test`/`expect`
    // globals, incompatible with vitest's), same directory-based unit/e2e
    // split apps/api already uses (src/**/*.spec.ts vs test/**/*.e2e-spec.ts).
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    environment: 'node',
  },
});
