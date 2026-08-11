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
  createdAt: z.iso.datetime(),
  lineItems: z.array(invoiceLineItemSchema),
});
export type Invoice = z.infer<typeof invoiceSchema>;
