import { z } from "zod";

/**
 * FEAT-046 (docs/plans/feat-046-billing-payments.md, ADR-0041): single
 * source of truth for both `apps/api`'s `POST /v1/invoices/:id/payments`
 * request validation and `apps/web`'s take-payment form's client-side
 * field errors -- same discipline `onboarding.ts`'s own header comment
 * establishes.
 */
export const paymentMethodSchema = z.enum(["cash", "mobile_money"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentRequestSchema = z.object({
  method: paymentMethodSchema,
  amountCents: z.number().int().positive(),
  reference: z.string().min(1).max(200).optional(),
});
export type PaymentRequestInput = z.infer<typeof paymentRequestSchema>;

export const invoiceStatusSchema = z.enum(["unpaid", "partial", "paid"]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md):
 * the literal follow-up ADR-0041's own Consequences section named
 * ("multi-payer (insurance) support... real, tracked gap"). 'corporate'
 * means billed to referringFacilityId instead of the patient directly --
 * stays a thin categorical tag, never a ledger/adjudication record.
 */
export const invoicePayerTypeSchema = z.enum(["cash", "corporate"]);
export type InvoicePayerType = z.infer<typeof invoicePayerTypeSchema>;

export const generateInvoiceRequestSchema = z
  .object({
    payerType: invoicePayerTypeSchema.optional(),
    referringFacilityId: z.uuid().optional(),
  })
  .refine((body) => body.payerType !== "corporate" || body.referringFacilityId !== undefined, {
    message: "referringFacilityId is required when payerType is 'corporate'",
  })
  // Every existing caller of POST /v1/orders/:id/invoice (FEAT-046) sends no
  // body at all -- `.default({})` so a request with no Content-Type/body
  // still parses (as cash/no referring facility) instead of failing Zod's
  // "expected object, received undefined" before this route's own optional
  // fields ever get a chance to apply their own defaults.
  .default({});
export type GenerateInvoiceRequestInput = z.infer<typeof generateInvoiceRequestSchema>;

export const paymentStatusSchema = z.enum(["pending", "succeeded", "failed"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

// Response shape for `GET /v1/invoices/:id` -- drives both the OpenAPI
// response schema (`@ZodResponse`, apps/api) and `apps/web`'s own typed
// SDK read, same "one schema, three consumers" discipline `patient.ts`'s
// own header comment establishes.
export const invoiceLineItemSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  invoiceId: z.uuid(),
  testDefinitionId: z.uuid(),
  billingCode: z.string().nullable(),
  unitPriceCents: z.number().int(),
  quantity: z.number().int(),
  amountCents: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

export const invoiceSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  orderId: z.uuid(),
  patientId: z.uuid(),
  // Issue #715: human-readable invoice number (`INV-YYMMDD-NNNNNN`).
  // Nullable only for invoices created before this field existed -- every
  // invoice generated after this migration always has one
  // (billing.service.ts's own generateInvoice()).
  invoiceNumber: z.string().nullable(),
  status: invoiceStatusSchema,
  totalCents: z.number().int(),
  // Derived from the sum of `succeeded` payment rows (never stored) --
  // `PaymentService.getPaidCents`, apps/api/src/billing/payment.service.ts
  // -- the single source of truth the take-payment form uses to default to
  // the real remaining balance instead of the invoice's full total. Fixes
  // a real, confirmed bug: without these fields the frontend had no way to
  // tell "partial with $10 left" from "partial with $200 left" and
  // defaulted to the full total on every partial invoice, which a missing
  // server-side guard then let through as a real overpayment.
  amountPaidCents: z.number().int(),
  balanceDueCents: z.number().int(),
  payerType: invoicePayerTypeSchema,
  referringFacilityId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  lineItems: z.array(invoiceLineItemSchema),
});
export type Invoice = z.infer<typeof invoiceSchema>;

// Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md): `GET
// /v1/invoices` query filters. `branch` (named in the issue's own body) is
// deliberately absent -- no `branch` concept exists anywhere in this schema
// (confirmed by a repo-wide grep), not buildable without inventing a new
// concept this task isn't scoped to add. `hasBalance` maps to
// `balanceDueCents > 0`, computed the same way the detail route already
// does (`PaymentService.getPaidCents`), never a second source of truth.
//
// `hasBalance` is `z.enum(['true', 'false'])`, never `z.coerce.boolean()` --
// `qc-rule-violation.controller.ts`'s own `resolved` field documents the
// exact footgun this avoids: query params always arrive as strings, and
// `z.coerce.boolean()` coerces the literal string `'false'` to `true`
// (`Boolean('false') === true`), silently making `?hasBalance=false` behave
// like `?hasBalance=true`. Confirmed live, not hypothetical -- this exact
// bug broke this route's own e2e regression test
// (`billing.e2e-spec.ts`'s "filters by hasBalance" case) before this fix. No
// `.transform()` to a real boolean either, same reasoning that controller's
// own comment already gives (ADR-0013 §1's global `ZodValidationPipe` runs
// this schema twice); the controller compares the raw string instead.
export const invoiceListQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  payerType: invoicePayerTypeSchema.optional(),
  patientId: z.uuid().optional(),
  hasBalance: z.enum(['true', 'false']).optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
  // Issue #704 (EPIC #697): the facility-statement screen's own filter --
  // "every invoice billed to this facility in this date range." Combine
  // with createdFrom/createdTo (already existed) rather than a new
  // date-range-specific route.
  referringFacilityId: z.uuid().optional(),
  // Pilot-readiness audit fix (P0, duplicate-invoice bug): lets the order
  // detail page ask "does this order already have an invoice?" before
  // rendering a "Generate invoice" action -- the actual UI-side fix for a
  // user landing back on the order page (back button, re-navigation, a
  // second tab) after already generating one, not just the same-click race.
  orderId: z.uuid().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

// Thinner than `invoiceSchema` -- no `lineItems`, matching
// `CaseListResponseDto`'s own "list rows are thinner than detail rows"
// precedent (`apps/web`'s existing detail page already renders the full
// line-item breakdown; a list row just needs enough to summarize + link).
export const invoiceListItemSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  // Issue #704: patient-level detail on a facility statement needs a real
  // name, not just an id -- a plain join onto `patient`, never a second
  // source of truth for the name itself.
  patientName: z.string(),
  invoiceNumber: z.string().nullable(),
  status: invoiceStatusSchema,
  payerType: invoicePayerTypeSchema,
  totalCents: z.number().int(),
  amountPaidCents: z.number().int(),
  balanceDueCents: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;

export const invoiceListResponseSchema = z.object({
  items: z.array(invoiceListItemSchema),
});
export type InvoiceListResponse = z.infer<typeof invoiceListResponseSchema>;

/**
 * Issue #711 (docs/plans/task-711-invoice-email-delivery.md): same exact
 * shape as `caseReportSendEmailRequestSchema` (anatomic-pathology.ts) --
 * `to` optional, resolved server-side to the invoice's own patient's
 * on-file email when omitted. Plain-text/HTML body only (proposal §10 Q1,
 * approved) -- no PDF attachment, since no invoice PDF generator exists in
 * this repo.
 */
export const invoiceSendEmailRequestSchema = z.object({
  to: z.email().optional(),
});
export type InvoiceSendEmailRequestInput = z.infer<
  typeof invoiceSendEmailRequestSchema
>;
