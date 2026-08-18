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
