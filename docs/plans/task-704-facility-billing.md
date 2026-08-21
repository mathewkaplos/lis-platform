# Implementation Proposal: Facility billing — date-range, multi-patient, consolidated statement
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #704 (part of EPIC #697)

## 1. Goal

The design partner's own stated real-world scenario: *"this facility wants
one invoice for all patients/tests performed between date X and date Y."*
Confirmed via the pilot-readiness audit that no path existed for this —
neither UI nor any consolidated-billing concept at all.

## 2. Key discovery before writing any code

`BillingService.generateInvoice()` (`apps/api/src/billing/billing.service.ts`)
**already supports** `payerType: 'corporate'` + `referringFacilityId` at the
service layer, including facility-existence validation — shipped under
FEAT-066 (ADR-0053) but with **zero UI caller ever passing it through**
(`generate-invoice-button.tsx` always sent an empty body). This materially
changed the shape of this task from "build facility billing from nothing"
to "wire up the UI to what already exists, plus build the one genuinely
missing piece: a consolidated, date-ranged view."

## 3. Design decision: a view, not a new billing primitive

`invoice` is deliberately "one invoice = one order" (ADR-0041's own "never
a ledger/subledger" boundary, `billing.ts`'s header comment). Making a
single DB invoice row span multiple orders would require either a schema
change (nullable `invoice.orderId` + a new join table) or re-deriving line
items from scratch — both real, separate decisions this task's own scope
doesn't need to force. Instead:

- **Order-entry time**: reception picks a referring facility on the order
  form (already existed, unblocked by #699).
- **Invoice-generation time**: `GenerateInvoiceButton` now automatically
  bills that facility (`payerType: 'corporate'`) when the order has one set
  — no new UI needed, since the commitment was already made at booking.
- **Statement time**: a new `/billing/facility-statement` screen queries
  `GET /v1/invoices?referringFacilityId=X&createdFrom=Y&createdTo=Z` (a new
  filter on the existing, already-rich invoice-list endpoint — it already
  had `createdFrom`/`createdTo`) and presents every matching invoice as one
  consolidated, printable statement with patient-level detail and a
  facility-level total.

This delivers the real user value (one document to hand the facility) via
a presentation-layer aggregation, without touching `invoice`'s core
per-order-snapshot invariant.

## 4. Affected files

- `apps/web/app/(app)/orders/[id]/actions.ts` — `generateInvoice()` accepts
  an optional `referringFacilityId`; passes `payerType: 'corporate'` when
  present.
- `apps/web/app/(app)/orders/[id]/generate-invoice-button.tsx` — accepts
  `referringFacilityId` prop.
- `apps/web/app/(app)/orders/[id]/page.tsx` — passes `order.referringFacilityId`
  through.
- `packages/domain/src/billing.ts` — `invoiceListQuerySchema` gains
  `referringFacilityId`; `invoiceListItemSchema` gains `patientName`.
- `apps/api/src/billing/billing.controller.ts` — `list()` filters by
  `referringFacilityId`; joins `patient` for `patientName` (a real join,
  never a second source of truth for the name).
- `apps/web/app/(app)/billing/invoices/invoices-table.tsx` — shows
  `patientName` instead of a raw `patientId`.
- `apps/web/app/(app)/billing/facility-statement/page.tsx` (new) — the
  statement screen itself.
- `apps/web/app/(app)/billing/facility-statement/print-button.tsx` (new) —
  matches `invoice-view.tsx`'s own `window.print()` precedent.
- `apps/web/app/(app)/_components/sidebar.tsx` — new "Facility statement"
  nav entry, same standing as "Invoices."

## 5. Architecture consulted

`billing.service.ts`'s own existing `payerType`/`referringFacilityId`
support (FEAT-066) — this proposal wires up an existing capability, it
doesn't invent a new one at the generation layer. `invoice-view.tsx`'s own
`window.print()` button for the print affordance.

## 6. Skills loaded

`engineering/api-design` (existing route modified: new query filter + join)
and `engineering/frontend-design` (new page + form).

## 7. Assumptions & autonomous decisions

- **No new consolidated DB invoice row** — a deliberate, explained scope
  boundary (§3 above), not an oversight.
- **Date inputs are calendar dates** (`<input type="date">`), widened to
  the full day range (`T00:00:00.000Z` to `T23:59:59.999Z`) server-side in
  the page — a real lab user thinks in calendar days, not UTC instants.
- **`patientName` is a plain string** (`firstName lastName`), not a
  structured object — matches this list response's own "thinner than
  detail" precedent; the invoice detail page already has the full patient
  record if needed.

## 8. Risks

Low-medium. The `list()` endpoint's query shape changed (new join) but its
existing filters/response fields are unchanged and additive-only — no
existing caller breaks.

## 9. Acceptance criteria

- An order with a referring facility set, once invoiced, is billed to that
  facility (`payerType: 'corporate'`) automatically.
- `/billing/facility-statement?facilityId=X&from=Y&to=Z` shows every
  invoice billed to that facility in that range, with patient-level detail
  and a facility-level total, and prints via the existing `print:` Tailwind
  convention.
- Verified live end to end: created a real facility, a real patient, a real
  order tied to that facility, generated an invoice (confirmed
  `"payerType":"corporate"` in the response), confirmed it appears via both
  the raw API filter and the rendered statement page.

## 10. Testing plan

`pnpm typecheck`/`lint` clean (api + web). Live verification against the
running dev API/web, full real flow: facility → patient → order (with
`referringFacilityId`) → invoice (confirmed `payerType: 'corporate'`) →
`GET /v1/invoices?referringFacilityId=...` (confirmed `patientName` +
correct filtering) → `/billing/facility-statement` page (confirmed real
HTML: patient name, invoice number, facility name, "Facility total").

## 11. Rollback plan

Revert the listed files. No schema/migration change.
