# Implementation Proposal: Invoice List (§17.1 only, scoped down from #489)
Status: APPROVED
ADR: none new (reuses ADR-0041/ADR-0053's existing scope boundary)    Date: 2026-08-20    Backlog ID: issue #489 (FEAT-046 follow-up), scoped to §17.1 only

**Approved 2026-08-20** via the native options-prompt (all three §10 questions accepted as
drafted: no pagination in this first pass, `branch` filter cut entirely — not buildable, no
backing concept — rather than blocking on a new branch-modeling proposal, route stays
`manage_billing`-gated rather than following `case.controller.ts list()`'s own flagged-as-a-gap
ungated precedent).

## 1. Goal

Issue #489 names three deferred FEAT-046 screens (§17.1 Invoice List, §17.5 Outstanding
Balances, §17.6 Refunds) and states its own precondition: pick it up "once FEAT-046 has landed
and the design partner has real feedback on the first slice." FEAT-046 has landed, but no
design-partner feedback on the shipped first slice is visible anywhere — confirmed by a prior
investigation comment on the issue itself (2026-08-12) and re-confirmed here (no new comments,
nothing in any breadcrumb since). That half of the issue's own gate is not satisfied.

That same investigation comment found the three deferred screens are not equally scoped against
ADR-0041's "UI/query surface on existing tables, not a new architectural decision" framing:

- **§17.1 Invoice List** — genuinely just a filtered `GET /v1/invoices` query. No schema change,
  no new business process. Fits the "just UI" framing cleanly.
- **§17.5 Outstanding Balances** — "reminder sending" and "payment-plan actions" (both named in
  the issue's own body) are new behavior with no existing mechanism (no notification system, no
  installment concept anywhere in this schema).
- **§17.6 Refunds** — doesn't fit "just UI" at all: `payment.status` has no `refunded` value, no
  refund-to-payment link exists, and "an approval step above a threshold" is a real
  business-process decision this repo hasn't made.

Per the human's own explicit decision this session (asked directly, given the unmet
design-partner gate): proceed with **§17.1 Invoice List only**, on the reasoning that it alone
carries no schema/process risk and needs no design-partner input to build correctly. §17.5 and
§17.6 stay deferred, tracked against #489, not silently dropped or folded in here.

## 2. Affected files

- `apps/api/src/billing/billing.controller.ts` — new `GET /v1/invoices` route, `list()`, mirroring
  `case.controller.ts`'s own `list()` shape exactly (query-schema-driven filter, `JwtAuthGuard`
  only — no, see note below — `CapabilityGuard`/`manage_billing`, matching every other route on
  this controller, unlike `case.controller.ts`'s deliberately ungated list route; billing data is
  financial, not diagnostic-lineage, so the existing `manage_billing` gate this controller already
  enforces on every other route stays consistent here, not weakened to match `case`'s own
  documented-as-a-gap ungated precedent).
- `packages/domain/src/billing.ts` — new `invoiceListQuerySchema` (optional `status`, `payerType`,
  `patientId`, `createdFrom`/`createdTo` — see §5 on which of the issue's named filters are
  actually buildable) and `invoiceListItemSchema`/`invoiceListResponseSchema` (a lighter shape
  than the full `invoiceSchema` — no `lineItems` array, matching `CaseListResponseDto`'s own
  "list rows are thinner than detail rows" precedent).
- `apps/web/auth/roles.ts` — new `hasBillingRole` helper (technologist + verifier, matching
  `manage_billing`'s real grant — confirmed via `capabilities.ts`), following the
  one-helper-per-capability convention `hasSpecimenManagementRole`'s own comment already
  established, since no existing helper maps to `manage_billing` today.
- `apps/web/app/(app)/billing/invoices/page.tsx` (new) — list page: a table of invoices
  (patient, status, payer type, total/paid/balance, created date), status-filter tabs (Unpaid /
  Partial / Paid / All — mirroring #613's own `STAGE_TABS`/`searchParams`-driven pattern on
  `cases/page.tsx`, the established convention for exactly this shape of screen in this repo),
  each row linking to the existing `/billing/invoices/[invoiceId]` detail page. Gated on
  `hasBillingRole`.
- `apps/api/test/billing.e2e-spec.ts` — new list-route coverage: RBAC (non-billing role 403),
  status-filter correctness, tenant isolation (a cross-tenant invoice never appears), pagination
  if included (see §5 open question).
- `apps/api/src/billing/billing.service.spec.ts` / `apps/web` — no changes needed beyond the new
  route/page; no existing behavior changes.

## 3. Architecture consulted

- ADR-0041 (billing thin-edge scope boundary) — this proposal builds only query surface on the
  existing `invoice` table, no new concept.
- ADR-0053 (`payerType`/`referringFacilityId` on `invoice`) — the payer filter this issue's own
  body names (`payer`) maps directly to `invoice.payerType`, already present.
- `engineering/billing` Skill — entry #3 ("no ledger/AR/adjudication, and it must stay that way")
  directly governs what this list route may and may not compute; entry #1 (Date→ISO before
  `@Audit()`) doesn't apply here (a `GET` list route isn't `@Audit()`-decorated, matching
  `case.controller.ts list()`'s own unaudited precedent); entry #2 (DTO classes, not bare inline
  param/query types) applies to the new query DTO.
- `case.controller.ts`'s `list()` — direct structural precedent for a filtered, tenant-scoped list
  route returning a thinner-than-detail row shape.
- `engineering/api-design` (loaded per the `plan` Skill's own rule: any new `apps/api` route
  requires this regardless of whether the issue names it) — entry #8 (`ZodValidationPipe` needs
  the schema passed explicitly for `@Query()` too, not just `@Body()`/`@Param()`); the OpenAPI/SDK
  regeneration step (`billing` Skill entry #2's own finding: a bare inline query type produces no
  OpenAPI docs for that parameter — the new query DTO must be a proper `createZodDto` class from
  the start).
- `engineering/frontend-design` (loaded per the `plan` Skill's own rule: any new `apps/web` page
  requires this regardless of whether the issue names it) — `cases/page.tsx`'s own
  `searchParams`-driven status-tab pattern is the direct template to reuse, not reinvent.
- `engineering/rls-multi-tenancy` — no new table, but the new list query must still rely on RLS
  (not an application-layer tenant filter) for isolation, matching every other list route in this
  codebase.

## 4. Skills loaded

- `engineering/billing` — full v1 (all 5 entries read; entries #2, #3 directly apply).
- `engineering/api-design` — entries #2 (DTO classes for every param/query type), #8
  (`ZodValidationPipe` explicit-schema requirement).
- `engineering/frontend-design` — the `searchParams`/status-tab list-page pattern, and the
  recurring-mistake entries on function-valued props into Client Components / route-group URL
  prefixes.
- `engineering/database-design` — confirms no schema/migration is needed (a pure read query).
- `engineering/testing` — entry #1 (real-Postgres integration checks) for the new e2e coverage.

## 5. Assumptions & autonomous decisions

- **Filters scoped to what the schema actually supports today: `status`, `payerType`,
  `patientId`, and a `createdAt` date range.** The issue's own body additionally names "branch"
  and "has-balance" as filter criteria. `branch` has no corresponding concept anywhere in this
  schema (confirmed by a repo-wide grep — no `branch` column/table exists at all) — not buildable
  without inventing a new concept this proposal isn't scoped to add, so it's cut, not silently
  attempted. `has-balance` (i.e., `balanceDueCents > 0`) *is* buildable — `balanceDueCents` is
  already a derived field (`totalCents - amountPaidCents`, from `PaymentService.getPaidCents`) —
  included as a boolean `hasBalance` query filter, computed the same way the existing detail
  route already does, not a new source of truth.
- **List route stays `manage_billing`-gated (`CapabilityGuard`), not left ungated like
  `case.controller.ts list()`.** `case`'s own ungated list route is itself a documented,
  flagged-but-accepted gap (session 40 breadcrumb: "no CapabilityGuard at all... read-only, no
  capability gate"), not a pattern to propagate into a second, financial-data controller. Every
  other route on `BillingController` is already `manage_billing`-gated; this stays consistent
  with its own file, not with a different controller's already-named gap.
- **Response DTO omits `lineItems`** (unlike the detail route's `invoiceSchema`) — a list of
  potentially many invoices doesn't need every row's full line-item breakdown; the existing detail
  page already renders that. Matches `CaseListResponseDto`'s own thinner-than-detail precedent.
- **No pagination in this first pass.** Every other list route in this codebase (`cases`, `orders`)
  currently returns an unpaginated array; matching that existing (if imperfect) precedent rather
  than introducing the first paginated list endpoint in this feature specifically — flagged as
  §10 Q1 since it's a real, visible choice, not hidden in the weeds.
- **No "reminder sending" or "payment-plan" actions** — those are §17.5's own named scope, not
  built here; this page is read-only browsing plus links into the existing detail/payment flow.

## 6. Risks

- **Placeholder billing data.** Every invoice in this system today was generated against the
  starter catalogs' placeholder `$15.00`/`-PLACEHOLDER` pricing (`billing` Skill entry #4) — the
  list view will render real-looking totals that are not real payer-negotiated prices. No new risk
  this proposal introduces, but worth restating since a list view makes many invoices visible at
  once, unlike the single-invoice detail page.
- **No design-partner feedback exists yet on the invoice detail/payment/receipt UX this list page
  links into** — if that feedback later changes the detail page's shape, the list page's own
  linking/row-summary fields may need to change too. Accepted, not mitigated, since waiting for
  that feedback is exactly the gate this proposal is deliberately not waiting on (per the human's
  own explicit decision in §1).

## 7. Acceptance criteria

- [ ] `GET /v1/invoices` returns only the calling tenant's invoices (RLS-proven, not just
      application-filtered) and 403s for a caller without `manage_billing`.
- [ ] `status`/`payerType`/`patientId`/`hasBalance`/date-range filters each narrow the result set
      correctly, individually and in combination.
- [ ] The new `/billing/invoices` page renders the status-filter tabs, a row per invoice with
      patient/status/payer/total/paid/balance/date, and each row links to the correct existing
      `/billing/invoices/[invoiceId]` detail page.
- [ ] A non-billing-role session sees no entry point to the list page and a direct navigation
      attempt is correctly blocked (matching the existing detail page's own `error.tsx` 403
      handling).
- [ ] `openapi.json`/`@lis/sdk` regenerated and the new route's `query` parameters show real typed
      fields, not `query?: never` (billing Skill entry #2's own regression check).

## 8. Testing plan

- Unit: none new beyond what §7's acceptance criteria cover at the integration level — this is a
  pure read/filter route with no service-layer business logic beyond the existing
  `getPaidCents`/`balanceDueCents` computation the detail route already exercises.
- Integration (real Postgres): `billing.e2e-spec.ts` — RBAC, each filter individually and
  combined, tenant isolation (a second-tenant invoice never appears regardless of filter).
- Manual (`web-verify`): the new list page driven through a real headless browser — status tabs,
  row-to-detail navigation, empty state (no invoices matching a filter), a non-billing-role
  session's blocked access — light/dark, per this repo's own established manual-verification bar
  for every new `apps/web` page this session.

## 9. Rollback plan

One new route, one new query/response schema pair, one new page, one new role helper — no schema
migration, no change to any existing route's behavior or response shape. A plain revert removes
the feature with zero data or contract implications for anything else.

## 10. Questions requiring human approval

1. **No pagination in this first pass** (matching `cases`/`orders`' own existing unpaginated list
   precedent) — accept, or require pagination from the start given billing data could plausibly
   grow large per tenant faster than case/order data does?
2. **`branch` filter cut entirely** (no concept exists anywhere in this schema to filter by) —
   confirm this is acceptable to leave out rather than treating it as a signal to open a
   `branch`-modeling proposal now?
3. **List route stays `manage_billing`-gated**, deliberately not following `case.controller.ts
   list()`'s own ungated precedent — confirm this is the right read (financial data warrants the
   gate; `case`'s ungated list is itself a flagged gap, not a pattern to copy)?
