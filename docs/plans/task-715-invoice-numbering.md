# Implementation Proposal: Human-friendly invoice numbering
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #715 (part of EPIC #697)

## 1. Goal

Invoices were identified only by raw UUID in the URL, the invoice view, and
the printed receipt. Add a human-readable invoice number, matching the
existing case-accession-number precedent.

## 2. Affected files

- `packages/db/src/schema/billing.ts` — new nullable `invoiceNumber` column
  + a per-tenant unique index on `invoice`.
- `db/migrations/0063_invoice_number.sql` (drizzle-generated column/index),
  `db/migrations/0064_invoice_number_sequence.sql` (hand-written
  `invoice_number_seq` + grant, mirroring `0014_accession_sequence.sql`
  exactly) — plus matching `meta/` journal/snapshot entries.
- `packages/db/src/accession.ts` — new `generateInvoiceNumber()`, same
  date-prefix + global-sequence shape as `generateAccessionNumber()`.
  Format: `INV-YYMMDD-NNNNNN`.
- `packages/db/src/index.ts` — re-export.
- `apps/api/src/billing/billing.service.ts` — `generateInvoice()` calls
  `generateInvoiceNumber()` and stores it.
- `apps/api/src/billing/billing.controller.ts` — list endpoint's manual DTO
  mapping gains `invoiceNumber` (the detail endpoint's `toInvoiceDto` uses a
  `...row` spread, so it needed no change).
- `packages/domain/src/billing.ts` — `invoiceSchema`/`invoiceListItemSchema`
  gain `invoiceNumber: z.string().nullable()`.
- `apps/web/app/(app)/billing/invoices/[invoiceId]/invoice-view.tsx` — shows
  the invoice number in the header and the receipt (falls back to `id` for
  pre-existing invoices with none).
- `apps/web/app/(app)/billing/invoices/invoices-table.tsx` — new "Invoice #"
  column.

## 3. Architecture consulted

`packages/db/src/accession.ts`'s own `generateAccessionNumber()` — this
proposal deliberately reuses its exact format/mechanism (date prefix +
`nextval()` on a dedicated global sequence) rather than inventing a second
numbering scheme, per its own header comment's reasoning (lock-free under
concurrent callers). A separate `invoice_number_seq`, not
`accession_number_seq` — invoices and cases are unrelated counters that
happen to share a format.

## 4. Skills loaded

`engineering/database-design` (a free-standing `SEQUENCE` has no
drizzle-schema-builder equivalent, confirmed via `0014_accession_sequence.sql`'s
own header comment citing that Skill's entry #5) and `engineering/api-design`
(existing `apps/api` route modified).

## 5. Assumptions & autonomous decisions

- `invoiceNumber` is nullable at the schema level (pre-existing invoices
  from before this migration have none) but always populated for every
  invoice generated from now on — matches `orgSettingsSchema`'s own
  "nullable for legacy rows, always-set going forward" precedent from #706.
- The receipt/detail view falls back to `invoice.id` when `invoiceNumber` is
  null, rather than showing a blank.

## 6. Risks

Low-medium — this is the second migration numbered from `main` in the same
session (the first was #706's `0062`, on its own unmerged branch); this PR's
migrations are numbered `0063`/`0064` to avoid a collision once both merge.
Verify migration order still applies cleanly after #706 lands first.

## 7. Acceptance criteria

- Generating an invoice produces a real `invoiceNumber` (format
  `INV-YYMMDD-NNNNNN`), confirmed via direct API call:
  `"invoiceNumber":"INV-260821-000010"`.
- `GET /v1/invoices` (list) and `GET /v1/invoices/:id` (detail) both return
  it.
- The invoice detail page and invoice list both display it.

## 8. Testing plan

- `pnpm --filter api typecheck`/`lint`, `pnpm --filter web typecheck`/`lint`
  all clean.
- Full local run of `apps/api/test/billing.e2e-spec.ts` (13/13 passing) —
  confirms no regression to the existing invoice-generation/payment flow.
- Live verification against the real running dev API: generated a real
  invoice via `POST /v1/orders/:id/invoice`, confirmed `invoiceNumber` in
  the response, then confirmed it also appears in `GET /v1/invoices`.

## 9. Rollback plan

Revert the schema/migration/controller/domain/web changes. The two new
migrations are additive-only (nullable column + index, a new sequence) — no
data loss on rollback.
