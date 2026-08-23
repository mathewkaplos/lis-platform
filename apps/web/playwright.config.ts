import { defineConfig, devices } from '@playwright/test';

/**
 * apps/web's first real-browser integration harness -- server actions
 * (`'use server'` files) call `getValidAccessToken()`, which needs
 * Next.js's own request-scoped `cookies()`; that can't be invoked from a
 * plain vitest process without either mocking `next/headers` (a precedent
 * this repo has deliberately avoided everywhere else -- `apps/web/auth/
 * access-token.spec.ts`'s own header comment) or driving a real browser
 * against a real running server, exercising the actual `'use server'`
 * action exactly as production does. Chose the latter.
 *
 * `fullyParallel: false` / `workers: 1`: specs share one live tenant
 * (same `test-user`/TENANT_A this whole repo's e2e specs already use) --
 * concurrent specs mutating the same real data would be flaky by
 * construction, same reasoning `apps/api/test/vitest.e2e.config.ts`'s own
 * `fileParallelism: false` comment gives for the identical shared-tenant
 * constraint.
 */
export default defineConfig({
  testDir: './e2e',
  // Generous, not tight: the first test in a run against a freshly-started
  // `next dev` pays real on-demand compilation cost on its first
  // navigation (confirmed live -- see e2e/auth.ts's own comment), on top
  // of a real Keycloak OIDC round trip. Later tests in the same run are
  // fast once routes are warm.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // CI: a real production build + standalone server -- CI's own
  // `pnpm build` step (build-and-test job) already passes reliably on
  // every PR, and production mode has no watch/HMR step to be flaky about
  // at all, the more robust choice for a job that only ever runs once.
  //
  // Local (Windows) dev: `pnpm dev` instead. Tried the production build
  // locally too, first -- ruled out live: `next build` fails on this local
  // Windows dev machine independent of this change, at a page-prerender
  // step unrelated to anything here -- the exact already-documented,
  // sandbox-only "pnpm build fails locally, trust CI's own real pnpm
  // build instead" precedent this repo's own `web-verify` Skill already
  // establishes for the identical reason. `next dev` also hit a real,
  // separate, local-only quirk here (webpack module resolution
  // duplicating under two drive-letter casings, `D:\lis\...` vs
  // `D:\LIS\...` -- Windows preserves whatever casing a path was first
  // created with), producing intermittent `net::ERR_ABORTED`/repeated-
  // navigation flakiness in this harness's own local runs -- structurally
  // impossible on CI's case-sensitive Ubuntu filesystem, so not expected
  // to reproduce there. Reuses an already-running `pnpm dev` locally
  // (this repo's own dev-loop convention, `web-verify` Skill) rather than
  // starting a second instance on top of it.
  //
  // CI's `next.config.ts` sets `output: "standalone"` -- `next start`
  // doesn't work with that (prints a warning, never actually serves),
  // confirmed live by this harness's own first CI run: every test hung on
  // its first navigation until the 60s timeout, with the [WebServer] log
  // showing that exact warning. `apps/web/Dockerfile` (the real,
  // already-deployed production launch path) gives the correct command:
  // run the standalone `server.js` Next emits, after copying `.next/static`
  // and `public/` into its output tree the same way the Dockerfile does --
  // the standalone server doesn't serve those from their normal build
  // locations.
  webServer: {
    command: process.env.CI
      ? 'pnpm build && mkdir -p .next/standalone/apps/web/.next/static .next/standalone/apps/web/public && cp -r .next/static/. .next/standalone/apps/web/.next/static/ && cp -r public/. .next/standalone/apps/web/public/ && node .next/standalone/apps/web/server.js'
      : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180_000 : 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
