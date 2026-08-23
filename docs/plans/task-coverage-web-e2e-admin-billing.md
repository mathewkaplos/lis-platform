# Implementation Proposal: e2e coverage for admin CRUD + billing (Tier 3)
Status: PROPOSED (never run in CI yet)
ADR: n/a    Date: 2026-08-23    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Second follow-up to `task-coverage-web-e2e-harness.md` (PR #737) and
`task-coverage-web-e2e-clinical-spine.md` (PR #738). Per the user's
explicit choice of scope ("Tier 3 only: billing + admin CRUD") from the
prioritized list proposed after those two: the lower-risk, still-real
gaps in admin CRUD (`createUser`, `createTest`, `createReferenceRange`,
`updateOrgSettings`) and billing (`generateInvoice`, `recordPayment`).

## 2. What this adds

- `apps/web/e2e/admin-crud.spec.ts` — four self-contained tests, each with
  its own login (no shared workflow state between them, unlike the
  clinical spine): a `lab_admin` creating a staff user, a `qa`-roled user
  creating a test bound to an existing analyte, a `qa`-roled user adding a
  reference range (via the `SlideOver`/Radix Dialog "Add range" form), and
  a `qa`-roled user updating org settings (with a real persistence check —
  a fresh page load re-reading the saved phone number).
- `apps/web/e2e/billing.spec.ts` — one test: place an order for the
  seeded, priced GLU test → generate an invoice → record full payment →
  assert the invoice's real, persisted status flips to `paid`.
- `apps/web/e2e/auth.ts` — added `loginAsQa()` for `test-user-5` (TENANT_A,
  `qa` role — holds `manage_catalog`/`manage_org_settings`), the same
  fixture several `apps/api` e2e specs already rely on.

No new CI seed data needed — both specs reuse the chemistry catalog
(`db/seed/chemistry-catalog.sql`) already wired into `web-e2e`'s job for
the clinical-spine specs, including its placeholder pricing (`GLU` at
$15.00) that `generateInvoice` needs.

## 3. Architecture consulted

`apps/web/auth/roles.ts` (`hasLabAdminRole`/`hasQaRole` — confirmed which
seeded users hold which of the four gates); `apps/api/src/auth/
capabilities.ts` (`qa`'s own `manage_catalog`/`manage_org_settings`
grants); `clinical-workflow.spec.ts`'s own header comments (the
`getByLabel` exact:true pitfall, the `waitForURL`-before-`page.url()`
race, and the `CardTitle`-is-a-plain-`<div>` gotcha — all three lessons
applied directly here rather than rediscovered); `reference-ranges-
table.tsx` (confirmed the "Add range" form lives in a `SlideOver`/Radix
`Dialog`, and that a successful create closes it as its own success
signal, no separate inline text); `generate-invoice-button.tsx` /
`invoice-view.tsx` (confirmed both use client-side `router.push`/
`router.refresh()` on success, the same "client success state can
disappear before it renders" and "soft-navigation race" classes of bug
already found and fixed in the two prior PRs).

## 4. Assumptions & autonomous decisions

- `admin-crud.spec.ts`'s `createTest` test binds its new test to the
  catalog's existing Glucose analyte (via its own checkbox) rather than
  inventing a new one — `test_definition.code` is unique per tenant, not
  per analyte, so a second test can validly reference the same analyte.
  Its `displayName` ("E2E Admin Test") is deliberately different from
  "Glucose" so other specs' own `getByLabel(/Glucose/i)` catalog-checkbox
  selectors stay unambiguous regardless of file execution order.
- Reference-range creation is asserted by the "Add range" dialog closing
  (`reference-ranges-table.tsx`'s own `state.status === 'created'` branch
  is what closes it) — no separate inline "created" text exists on that
  screen, unlike every other create-form in this app.
- Not locally verified end-to-end, same pre-existing environment-specific
  reasons documented in both prior proposal docs.

## 5. Risks

Medium until the first real CI run — new selectors, and this is the
first spec here to interact with a `SlideOver`/Radix Dialog form. Expect
at least one iteration of CI-log-driven fixes, consistent with every
prior addition to this harness.

## 6. Testing plan

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — clean.
- CI's `web-e2e` job is the real proof — watched via `gh pr checks`,
  iterated on with real CI logs/artifacts (screenshots, traces, apps/api's
  own uploaded log) if any of the five new tests fail.

## 7. Rollback plan

Revert the files in §2. No schema/migration change — new test
infrastructure only.
