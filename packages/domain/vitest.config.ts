import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// packages/domain's first test config -- mirrors apps/web's own
// vitest.config.ts shape (plain node environment; these schemas are pure
// Zod, no I/O, so nothing here needs anything heavier).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
