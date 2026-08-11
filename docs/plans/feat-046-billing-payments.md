# Implementation Proposal: FEAT-046 Billing & payments (first slice)
Status: APPROVED
ADR: adr-0041 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-046 (#55)

**Approved 2026-08-11** via the native options-prompt (all four §10 questions accepted as
drafted: thin invoice/payment-status edge, 3-screen UI slice with a follow-up issue for the other
three, manage_billing granted to technologist+verifier, mobile-money provider stubbed).

## 1. Goal
M10's exit criterion is "a second tenant self-onboards, runs isolated in its region, and is
billed" — FEAT-045 and FEAT-049 shipped the first two; this is the last piece. Literal acceptance
criteria (issue #55): "an invoice is generated correctly from an order" and "a mobile-money payment
correctly reconciles against the invoice."

**This proposal's central finding, surfaced before any design choice: the issue's own named Stitch
prompts (§17.1–§17.6 — Invoice List, Invoice Details, Payment Screen, Receipt, Outstanding
Balances, Refunds) describe a fuller invoicing/AR/refunds suite than KB-35 (Billing Integration)
and KB-36 (Payment Integration) — both `Status: Canonical` — actually permit.** Both documents
state explicitly and repeatedly that this platform is never the accounting system: *"no ledgers, no
accounts receivable, no insurance adjudication live here"* (KB-35), correcting what they describe
as the incumbent system's *"fatal mistake."* ADR-0041 (drafted alongside this proposal) resolves
this: KB-36's own architecture diagram already includes an in-scope "invoice → pay → provider →
webhook → status" flow, so a thin invoice + payment-status model is not a violation of KB-35/36 —
but the fuller suite (discounts, tax, multi-payer/insurance, split payments, refund approvals,
AR-aging tracking) would be. This proposal builds only the thin edge ADR-0041 draws the line at.

## 2. Affected files
- `~/work/lis-engineering/adr/adr-0041-billing-stays-a-thin-invoice-plus-payment-status-edge-no-ledger-mobile-money-provider-stubbed.md` (new, drafted, Status: proposed) — the scope-boundary decision this whole feature depends on.
- `packages/db/src/schema/test-catalog.ts` — `test_definition` gains `billingCode` (text, nullable)
  and `priceCents` (integer, nullable) — catalog metadata per KB-35's own "billing codes on
  catalog" design decision. Nullable: existing seeded tests (chemistry/haematology starter packs)
  have no real pricing/code data yet, same "placeholder, not partner data" honesty those seed
  files' own header comments already established.
- `packages/db/src/schema/billing.ts` (new) — `invoice` (tenant-scoped: `id`, `tenantId`,
  `orderId` FK, `patientId` FK, `status` enum `unpaid`/`partial`/`paid`, `totalCents`,
  `createdAt`), `invoiceLineItem` (tenant-scoped: `id`, `tenantId`, `invoiceId` FK,
  `testDefinitionId` FK, `billingCode`/`unitPriceCents` **snapshotted at generation time**, not
  read live from `test_definition` — this repo's established "snapshot, never recompute"
  discipline, same as reference ranges/report template versions/workflow definitions), `payment`
  (tenant-scoped: `id`, `tenantId`, `invoiceId` FK, `method` enum `cash`/`mobile_money`,
  `amountCents`, `providerReference` nullable text, `status` enum `pending`/`succeeded`/`failed`,
  `createdAt`). All three carry `tenant_id` + RLS from their own migration, per Constitution Law
  #4.
- `apps/api/src/billing/` (new module):
  - `payment-provider.interface.ts` — `PaymentProvider { charge(input): Promise<{ providerReference:
    string; status: 'succeeded' | 'failed' }> }`.
  - `providers/stub-mobile-money-provider.ts` (new, only shipped implementation) — deterministic:
    succeeds after a short simulated delay, no network call, no real vendor. Mirrors
    `apps/api/src/ai/providers/stub-provider.ts`'s own shape exactly (FEAT-041 precedent).
  - `billing.service.ts` — `generateInvoice(tx, orderId)`: reads the order's ordered tests, snapshots
    each `test_definition`'s current `billingCode`/`priceCents` into `invoiceLineItem` rows, sums
    `totalCents`. Tests with no `priceCents` set are rejected with a clear 400 (an invoice cannot
    silently under-bill a line item as free) — a real, explicit gap tracked for the seed data, not
    a silent zero.
  - `payment.service.ts` — `recordPayment(tx, invoiceId, input)`: calls the configured
    `PaymentProvider`, writes a `payment` row, recomputes `invoice.status` from the sum of
    `succeeded` payments against `totalCents`.
  - `billing.controller.ts` — `POST /v1/orders/:id/invoice` (action sub-resource, per
    `api-design`/`standards/api-design.md`'s own convention — not `POST /v1/invoices`), `GET
    /v1/invoices/:id`, `POST /v1/invoices/:id/payments`.
  - `billing.module.ts`.
- `apps/api/src/auth/capabilities.ts` — new `manage_billing` capability (see §5 for the
  role-grant question).
- `apps/web/app/(app)/billing/` (new): invoice detail page (§17.2), take-payment screen (§17.3),
  receipt view (§17.4) — composed from existing `packages/ui` primitives. §17.1 (Invoice List),
  §17.5 (Outstanding Balances), §17.6 (Refunds) are explicitly **not** built in this slice (§10 Q1).
- `apps/api/test/billing.e2e-spec.ts` (new) — real Postgres: generate invoice from a real order →
  snapshot correctness → record a stub payment → status transitions to `paid` → RLS isolation
  proof on all three new tables.
- `~/work/lis-engineering/skills/engineering/billing/SKILL.md` (new, near-empty at first) — the
  issue's own named Required Skill doesn't exist yet; seeded with the ADR-0041 pointer, given its
  first real entries as actual corrections happen during implementation (this repo's established
  convention for a brand-new subsystem, same as `ai/governed-inference` at M9's start).

## 3. Architecture consulted
- KB-35 (Billing Integration), KB-36 (Payment Integration) — both canonical, both directly
  shaping this proposal's central scope decision (ADR-0041).
- KB-51 (Commercialization) — billing/payments named as part of the M10 commercial-readiness
  story.
- ADR-0004 (global vs. tenant-scoped tables) — `invoice`/`invoiceLineItem`/`payment` are
  operational, tenant-varying data, unambiguously tenant-scoped (contrast case, not exempt).
- ADR-0037/FEAT-041's own proposal — the direct precedent for a provider-interface seam with only
  a stub implementation shipped, real vendor decision deferred until a real consumer/market forces
  it (here: mobile money's real vendor and target market).
- `engineering/database-design` — snapshot-at-write-time discipline (reference ranges, report
  template versions) directly reused for invoice line items.
- `engineering/api-design` — action sub-resource convention (`POST /v1/orders/:id/invoice`, not a
  bare resource-CRUD shape), `@Audit()`/capability-guard ordering (entry #5), RFC 9457 error shape.
  **Required reading for this feature per the `plan` Skill's own rule** (any new `apps/api` route) —
  loaded from the start this time, not missed the way FEAT-049's own proposal missed it.

## 4. Skills loaded
- `engineering/billing` — does not exist yet; authored alongside this proposal, first real entries
  added during implementation (see §2).
- `engineering/api-design` — entries #1 (one schema, three consumers), #5/#6 (audit/capability
  ordering, which actions get audited), #8 (`ZodValidationPipe` needs the schema passed explicitly
  — the exact bug FEAT-049 just hit from omitting this Skill; not repeating it here).
- `engineering/database-design` — snapshot-write discipline, enum/text-discriminator conventions.
- `engineering/rls-multi-tenancy` — three genuinely new tenant-scoped tables, each needs its own
  `tenant_id` + policy from its own migration (entry #2: no exception for anything, including a
  join-shaped table like `invoiceLineItem`).
- `engineering/testing` — entry #1 (real-Postgres integration checks).

## 5. Assumptions & autonomous decisions
- **Scope boundary is ADR-0041's own decision** — thin invoice + payment-status tracking, no
  ledger/AR/adjudication, mobile-money provider stubbed. This is the single biggest scope
  commitment in this proposal — flagged as §10 question 1.
- **UI scoped to Invoice Details + Payment Screen + Receipt only** (§17.2/17.3/17.4). Invoice List
  (§17.1), Outstanding Balances (§17.5), and Refunds (§17.6) are real, tracked gaps against the
  issue's own named prompts, not silently dropped — flagged as §10 question 2, with a follow-up
  issue to be filed on approval.
- **`method` scoped to `cash` and `mobile_money` only** — card/insurance/bank all need their own
  real provider/adjudication decisions this feature doesn't make. The `payment.method` column is a
  plain text-discriminator (this repo's established convention, e.g. `reference_range.sex`), not a
  Postgres enum, so adding a method later is a value addition, not a migration to a new type.
- **A test with no `priceCents` set cannot be invoiced** — `generateInvoice` rejects with 400 rather
  than silently billing $0, surfacing the real seed-data gap (no starter-catalog test has billing
  metadata yet) instead of masking it. Backfilling real prices/codes onto the starter catalogs is
  explicitly out of scope here (placeholder data, same as the catalogs' own existing "not partner
  data" framing) — a design-partner question, not this feature's to invent.
- **`manage_billing` capability grant**: proposed to `technologist` + `verifier` (front-desk-
  adjacent grant, matching `manage_patients`/`manage_orders`/`manage_specimens`'s own established
  "no dedicated role exists yet" precedent in `capabilities.ts`) rather than inventing a new
  `cashier` Keycloak role — flagged as §10 question 3, since a `cashier` role is also a defensible
  reading of KB-10's own persona list and the Stitch library's own Cashier Dashboard (§3.4).
- **No HL7 DFT / external billing-system export.** KB-35's own hand-off mechanism to a real
  external billing/HIS/ERP system stays future work — no target system is named yet (KB-35's own
  "Open questions" agrees).

## 6. Risks
- **The seed-data gap (no starter-catalog test has `billingCode`/`priceCents`) means this feature
  cannot be demoed against the existing chemistry/haematology fixtures without first setting
  placeholder prices on a few of them** — a small, explicit follow-up task (seed data, not
  production code), called out so it isn't discovered as a surprise during the milestone demo.
- **The stub `PaymentProvider` always succeeds** — proves the mechanism, not real-world failure
  handling (declined transactions, timeouts, webhook retries). A real provider integration will
  need its own ADR covering exactly those cases; this proposal deliberately doesn't invent them
  speculatively.
- **`invoice.status` recomputation on every payment write** needs to be race-safe under concurrent
  payment attempts against the same invoice — same transaction-scoped discipline `OrderCreationService`
  and `writeAuditEvent` already establish (recompute inside the same transaction as the write, not
  a separate read-then-update).

## 7. Acceptance criteria
- [ ] `POST /v1/orders/:id/invoice` generates an invoice whose line items exactly snapshot the
      order's ordered tests' billing code/price at generation time — a later catalog price change
      never alters an already-generated invoice.
- [ ] An order containing any test with no `priceCents` set is rejected (400), not silently
      invoiced at $0.
- [ ] `POST /v1/invoices/:id/payments` with `method: 'mobile_money'` calls the stub provider,
      writes a `payment` row, and correctly transitions `invoice.status` (`unpaid` → `partial` →
      `paid`) based on the sum of succeeded payments — proven with partial-then-full payment
      sequences, not just one full payment.
- [ ] `invoice`, `invoiceLineItem`, and `payment` each carry their own `tenant_id` + RLS policy
      from their own migration; a live cross-tenant leak check proves isolation on all three.
- [ ] No general ledger, AR subledger, or insurance-adjudication concept exists anywhere in this
      schema.

## 8. Testing plan
- Unit: `billing.service.spec.ts` — snapshot correctness, the no-price-set rejection, total
  computation across multiple line items.
- Unit: `payment.service.spec.ts` — status-transition logic (unpaid/partial/paid) across payment
  sequences, mocked provider for both `succeeded` and `failed` outcomes.
- Integration (real Postgres, `engineering/testing` entry #1): `billing.e2e-spec.ts` — full
  order → invoice → payment → status-transition round trip, plus the RLS isolation proof.
- Manual: the three new screens driven through a real headless browser (`web-verify`), light/dark,
  keyboard-only, all four UI states.

## 9. Rollback plan
Three new tables, one new module, two new nullable catalog columns, no changes to any existing
route's behavior — a plain revert removes the feature with no data or contract implications for
anything else. `test_definition.billingCode`/`priceCents` being nullable means no existing seed
data or migration needs to change to add or remove them.

## 10. Questions requiring human approval
1. **Approve ADR-0041's scope boundary** — a thin invoice + payment-status edge (no ledger, no AR
   subledger, no insurance adjudication), directly resolving the tension between the issue's own
   named Stitch prompts and KB-35/36's canonical "never rebuild the ERP" architecture?
2. **Approve building only Invoice Details + Payment Screen + Receipt (§17.2/17.3/17.4) in this
   slice**, filing Invoice List/Outstanding Balances/Refunds (§17.1/17.5/17.6) as an explicit
   follow-up issue rather than building all six screens now?
3. **`manage_billing` capability: grant to `technologist`+`verifier`** (no dedicated role,
   matching the existing front-desk-adjacent precedent) **or introduce a new `cashier` Keycloak
   role** (matching KB-10's own persona list and the Stitch library's own Cashier Dashboard)?
4. **Approve the mobile-money provider being fully stubbed** (no real M-Pesa or other vendor
   integration, no real webhook endpoint) in this slice, with a real provider integration deferred
   to its own future ADR once a real target market/vendor is named?
