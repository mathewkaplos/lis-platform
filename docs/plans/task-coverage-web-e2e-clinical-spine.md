# Implementation Proposal: e2e coverage for the clinical spine + AP sign-out
Status: PROPOSED (never run in CI yet)
ADR: n/a    Date: 2026-08-23    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Follow-up to `task-coverage-web-e2e-harness.md` (PR #737, merged), which
built `apps/web`'s first real-browser Playwright harness against one
low-stakes action (`createReferringFacility`). Per the user's request to
extend that harness to the app's highest-value untested paths: the
clinical spine (register → order → receive → finalize → verify) and the
AP case sign-out path, prioritized in that order because a silent
regression there reaches a patient result or a signed report, not just an
admin list.

## 2. What this adds

- `apps/web/e2e/clinical-workflow.spec.ts` — one real-browser test driving
  `registerPatient` → `createOrder` → `receiveSpecimen` → `finalizeResult`
  → `verifyResult` in sequence, through real forms against the seeded
  chemistry catalog's GLU (Glucose) test. Verify is exercised from a
  **second, independent browser context** logged in as a different,
  pathologist-roled user (`test-user-4`) — proving both that verification
  works and that a technologist session's Verify control is genuinely
  absent from the DOM (`results-grid.tsx`'s `isVerifier` gate), not just
  hidden by CSS.
- `apps/web/e2e/case-sign-out.spec.ts` — one real-browser test driving
  `createCase` → `addBlock` → `addSlide` → `signOutCase`. Single
  pathologist-roled login for the whole flow (`test-user-4` again, who
  holds both `technologist` and `pathologist` — this flow's own real
  prerequisite capabilities). `signOutCase` carries `@RequireStepUp()`
  server-side; this only passes because `auth.ts`'s login is a real
  Authorization Code + PKCE browser flow (sets a fresh Keycloak
  `auth_time`), not a direct-grant token fetch (which this realm never
  attaches `auth_time` to at all — confirmed via
  `apps/api/test/get-keycloak-fresh-token.ts`'s own header comment).
- `apps/web/e2e/auth.ts` — added `loginAsPathologist()` for `test-user-4`
  (TENANT_A, `technologist`+`pathologist`), the same fixture
  `apps/api/test/case-sign-out.e2e-spec.ts` and `auto-verify.e2e-spec.ts`
  already rely on for verify/sign-out coverage.
- `.github/workflows/pr.yml` — `web-e2e` job now seeds
  `db/seed/chemistry-catalog.sql` (one discipline seed, not every
  `db/seed/*-catalog.sql` `build-and-test` runs) — both new specs need a
  real ordered test to exist; `referring-facilities.spec.ts` alone never
  did.

## 3. Architecture consulted

`apps/api/test/case-sign-out.e2e-spec.ts` (`createFinalizableCase()`'s own
minimal lineage shape — 1 part, 1 block, 1 slide, no screening/narrative
needed before finalize — reused directly rather than guessing at
prerequisites); its own header comment on why a real Authorization
Code+PKCE login is required for the positive step-up path;
`apps/web/app/(app)/orders/[id]/results/results-grid.tsx` and
`apps/web/auth/roles.ts` (`hasPathologistRole` — confirmed `test-user-4`
is the only seeded TENANT_A user carrying that role);
`apps/web/app/(app)/cases/case-status.ts` (`NOT_YET_SIGNED_STATUSES`
confirms a freshly-accessioned case's default `accessioned` status already
shows the Sign out card for a pathologist-roled session, no screening
step required); `db/seed/chemistry-catalog.sql` (GLU/Glucose fixture,
70–99 mg/dL reference interval — used 90 to land clearly in-range and
avoid `FinalizationRollupInterceptor`'s panel_hold branch, a real but
separate behavior out of this test's scope).

## 4. Assumptions & autonomous decisions

- Neither new spec fills in a patient's `birthDate` — `registerPatient`'s
  duplicate-check branch only runs when `birthDate` is present
  (`patients/new/actions.ts:80`); already-covered by construction, not by
  a dedicated test, and skipping it here keeps both specs focused on their
  own new ground.
- Chose a **second browser context**, not a second `page.goto('/api/auth/
  login')` in the same context, to switch to the pathologist identity in
  `clinical-workflow.spec.ts` — Keycloak's own SSO session cookie would
  otherwise silently re-authenticate as the already-logged-in
  technologist rather than show a login form for a different user.
- `case-sign-out.spec.ts` uses one login for the whole flow (unlike
  `clinical-workflow.spec.ts`'s deliberate two-session split) — nothing in
  that flow needs two different actors; `test-user-4` already holds both
  capabilities every step needs.
- Not locally verified end-to-end, for the same pre-existing,
  environment-specific reasons `task-coverage-web-e2e-harness.md` §4
  already documents (local `next build`/`next dev` issues unrelated to
  this new test code). Trusting CI, per that doc's established precedent.

## 5. Risks

Medium until the first real CI run — new selectors, new seed data
(`chemistry-catalog.sql` added to `web-e2e`'s job for the first time), and
a step-up-gated action (`signOutCase`) none of this harness's prior spec
exercised. Expect at least one iteration of CI-log-driven fixes, same as
both prior additions to this job needed.

## 6. Testing plan

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — clean.
- CI's `web-e2e` job is the real proof (see §4) — watched via
  `gh pr checks`, iterated on with real CI logs (downloaded
  screenshot/trace artifacts, per the existing `upload-artifact` step) if
  either spec fails.

## 7. Rollback plan

Revert the files in §2. No schema/migration change — new test
infrastructure and one additional CI seed step only.
