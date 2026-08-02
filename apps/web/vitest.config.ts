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
    exclude: ['**/node_modules/**', '**/.next/**'],
    environment: 'node',
  },
});
