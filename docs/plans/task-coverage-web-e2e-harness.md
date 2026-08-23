# Implementation Proposal: Real-browser e2e harness for apps/web server actions
Status: PROPOSED (never run in CI yet)
ADR: n/a    Date: 2026-08-23    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Per the user's ongoing request to keep improving automated test coverage:
`apps/web`'s server actions (`'use server'` files, e.g.
`admin/referring-facilities/actions.ts`) had zero coverage. They can't be
unit-tested from plain vitest — `getValidAccessToken()` needs Next.js's
own request-scoped `cookies()`, unavailable outside a real request. Asked
the user to choose between mocking `next/headers`, building a real
integration harness, or skipping this area; the user explicitly chose
**"Build a real integration harness"** — matching this repo's own
established "test the real thing" culture (`apps/web/auth/
access-token.spec.ts` calls a real Keycloak token endpoint rather than
mocking OIDC).

## 2. What this adds

- `apps/web/playwright.config.ts` — new Playwright Test config. CI drives a
  real production build (`next build && next start`); local dev reuses an
  already-running `pnpm dev`. `workers: 1` / `fullyParallel: false` since
  specs share one live tenant (same `test-user`/TENANT_A every other e2e
  spec in this repo already uses).
- `apps/web/e2e/auth.ts` — a real OIDC login helper, driving the actual
  Keycloak-hosted login page (not the `web-verify` Skill's session-cookie-
  signing shortcut, which exists for quick manual spot-checks only).
- `apps/web/e2e/referring-facilities.spec.ts` — first real test: submits
  the real `createReferringFacility` form in a real browser, asserts the
  created row survives a fresh full page reload (proving server-side
  persistence, not optimistic client state), and asserts the real
  server-side Zod validation error renders when the name is empty.
- `apps/web/package.json` — `@playwright/test` pinned to `1.62.1`,
  matching the `playwright` version already resolved transitively via
  `packages/ui`'s `axe-playwright`/`@storybook/test-runner`, avoiding the
  client-library/cached-browser-build version-mismatch footgun the
  `web-verify` Skill already documents. New `test:e2e` script.
- `apps/web/vitest.config.ts` — excludes `e2e/**` (Playwright's own
  `test`/`expect` globals conflict with vitest's), same directory-based
  unit/e2e split `apps/api` already uses.
- `.github/workflows/pr.yml` — new `web-e2e` job: own dedicated Postgres/
  Keycloak/MinIO (not `build-and-test`'s), since this suite creates real,
  named rows a real user could plausibly search for later — same
  job-isolation principle already applied to `rls-isolation-check`.
- `.gitignore` — added `test-results/`, `playwright-report/`,
  `blob-report/` (Playwright's own local run artifacts; were about to be
  accidentally tracked).

## 3. Architecture consulted

`apps/web/auth/access-token.spec.ts` (the "call the real thing" precedent
that drove the user's own choice); `apps/api/test/vitest.e2e.config.ts`'s
`fileParallelism: false` comment (same shared-tenant-data reasoning behind
this harness's `workers: 1`); `rls-isolation-check`'s own dedicated-CI-job
pattern (`.github/workflows/pr.yml`); `packages/ui/src/components/
form-field.tsx` (confirmed `getByLabel`/`#id` selectors resolve correctly
against real rendered forms via its `React.cloneElement` + `htmlFor`
wiring); `web-verify` Skill (Playwright/Chromium version-pinning footgun,
session-cookie-shortcut precedent explicitly not reused here).

## 4. Assumptions & autonomous decisions

- **Not locally verified end-to-end.** Local Windows testing hit two
  independent, pre-existing environment issues unrelated to this new test
  code: (a) `next build` fails locally at an unrelated `/admin/org-settings`
  prerender step, reproducing identically on a clean `main` checkout with
  zero changes — the same already-documented sandbox-only quirk the
  `web-verify` Skill records, where CI's own `pnpm build` is trusted
  instead; (b) `next dev`'s webpack module resolution intermittently
  duplicated module identities under two Windows drive-letter casings
  (`D:\lis\...` vs `D:\LIS\...`, NTFS case-preservation), producing
  `net::ERR_ABORTED`/repeated-navigation flakiness — structurally
  impossible on CI's case-sensitive Ubuntu filesystem. Given both, chose to
  trust CI (a real production build, case-sensitive filesystem) as the
  actual verification, following this repo's own established "trust CI
  over local sandbox quirks" precedent, rather than continuing to chase
  environment-specific failures locally.
- Login helper waits: `waitForURL(..., { timeout: 60_000 })` for the first
  post-login navigation specifically (confirmed live: a first run timed out
  at the default 30s purely on `next dev`'s cold on-demand-compile cost —
  the captured page snapshot at timeout already showed the authenticated
  dashboard), plus `waitForLoadState('networkidle')` after (confirmed live:
  without it, an immediate next `page.goto()` intermittently raced a
  still-in-flight post-callback redirect with `net::ERR_ABORTED`).
- Reverted an interim attempt to switch `page.goto()` calls to
  `waitUntil: 'domcontentloaded'` — self-caught: a snapshot showed both the
  mobile nav and the desktop `TopBar` present simultaneously pre-hydration,
  proving `domcontentloaded` fires before Tailwind/hydration settle and
  locks locators onto pre-hydration DOM. Reverted to the default `'load'`
  wait.
- `web-e2e`'s CI job steps have not been run yet — written from the same
  patterns `build-and-test` and `rls-isolation-check` already use, but this
  PR's own CI run is the first real test of whether it works at all.

## 5. Risks

Medium until the first real CI run: the new `web-e2e` job's exact service
startup/readiness sequencing (Keycloak realm import, apps/api health poll)
is untested. Expect at least one iteration of CI-log-driven fixes, same
as the `rls-isolation-check` job needed.

## 6. Testing plan

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — clean, no unrelated-file reformatting.
- `pnpm --filter web test` (vitest) — 20 tests pass, confirms `e2e/**`
  exclude keeps Playwright specs out of the vitest run.
- `pnpm --filter web test:e2e` — not reliably green locally (see §4);
  CI's `web-e2e` job is the real proof, to be watched via `gh pr checks`
  and iterated on with real CI logs if it fails.

## 7. Rollback plan

Revert all files listed in §2. No schema/migration change — new test
infrastructure only, no production code touched.
