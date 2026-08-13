import { z } from "zod";

/**
 * KB-02 Order aggregate, TASK-042 scope (docs/plans/feat-012-order-entry.md):
 * single source of truth for both request validation (nestjs-zod's
 * ZodValidationPipe) and OpenAPI generation — never a parallel, hand-
 * maintained schema (engineering/api-design Skill entry #1).
 */
export const orderPrioritySchema = z.enum(["routine", "stat"]);
export type OrderPriority = z.infer<typeof orderPrioritySchema>;

/** Order-level status. No canonical Order state machine exists in KB-03 (only
 * OrderedTest/Specimen/Observation/Report do) — TASK-042 writes only these
 * two real values (create -> 'ordered', full cascade cancel -> 'cancelled'),
 * per proposal §5/§10 Q1. */
export const orderStatusSchema = z.enum(["ordered", "cancelled"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Full canonical OrderedTest lifecycle (KB-03, 03-business-workflows.md:68-73).
 * TASK-042 wrote the first real values ('ordered'/'cancelled'); real writers
 * since then (verified directly against code — FEAT-017/TASK-061 proposal
 * finding #1): 'received'/'rejected' (TASK-047 reception), 'in_process'
 * (TASK-051 draft-save), 'resulted' (TASK-056 finalization roll-up). Only
 * 'collected'/'reported' remain unwritten; this column never reaches a
 * literal 'verified' value — that's tracked per-analyte on
 * observation.status instead. */
export const orderedTestStatusSchema = z.enum([
  "ordered",
  "collected",
  "received",
  "in_process",
  "resulted",
  "verified",
  "reported",
  "cancelled",
  "rejected",
]);
export type OrderedTestStatus = z.infer<typeof orderedTestStatusSchema>;

/**
 * At least one of testDefinitionIds/panelIds must be non-empty (proposal
 * §5): panelIds are expanded server-side into their member testDefinitionIds
 * and unioned with any directly-supplied testDefinitionIds, deduplicated —
 * ordering the same test both directly and via a panel creates exactly one
 * ordered_test row, not two.
 */
export const orderCreateSchema = z
  .object({
    patientId: z.uuid(),
    testDefinitionIds: z.array(z.uuid()).min(1).optional(),
    panelIds: z.array(z.uuid()).min(1).optional(),
    priority: orderPrioritySchema.optional(),
    // FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md).
    referringFacilityId: z.uuid().optional(),
    orderingProviderName: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      (body.testDefinitionIds && body.testDefinitionIds.length > 0) ||
      (body.panelIds && body.panelIds.length > 0),
    { message: "testDefinitionIds or panelIds (or both) is required" },
  );
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderedTestSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  orderId: z.uuid(),
  testDefinitionId: z.uuid(),
  status: orderedTestStatusSchema,
  createdAt: z.iso.datetime(),
});
export type OrderedTest = z.infer<typeof orderedTestSchema>;

/** TASK-044 (FEAT-012 proposal §2): a display projection, not the full
 * patient record -- just enough for a list/detail screen to show identity
 * without a second round trip. */
export const orderPatientSummarySchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  mrn: z.string(),
});
export type OrderPatientSummary = z.infer<typeof orderPatientSummarySchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  patientId: z.uuid(),
  status: orderStatusSchema,
  priority: orderPrioritySchema,
  // FEAT-066 (ADR-0053): see orderCreateSchema's own comment above.
  referringFacilityId: z.uuid().nullable(),
  orderingProviderName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  orderedTests: z.array(orderedTestSchema),
  // Optional: only POST /v1/orders' and POST /v1/orders/:id/cancel's
  // {resourceId, before, after} response isn't run through @ZodResponse
  // (order.controller.ts's own header comment) and doesn't populate this --
  // search()/getById() always do (TASK-044 proposal §2/§6).
  patient: orderPatientSummarySchema.optional(),
});
export type Order = z.infer<typeof orderSchema>;

/**
 * All filters are optional and combine with AND. No free-text search mode
 * (unlike patient's `q`) — FEAT-012's own AC only names status/priority/date
 * range, not name-based search; that's worklist-level (FEAT-017+), not built
 * ahead of a real need.
 */
export const orderSearchQuerySchema = z.object({
  patientId: z.uuid().optional(),
  status: orderStatusSchema.optional(),
  priority: orderPrioritySchema.optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
});
export type OrderSearchQuery = z.infer<typeof orderSearchQuerySchema>;

/** engineering/api-design entry #4: cursor pagination deliberately deferred
 * (ADR-0013 §Decision 4) — a fixed cap instead, same pattern as
 * PATIENT_SEARCH_RESULT_LIMIT, revisited once real order volume needs one. */
export const ORDER_SEARCH_RESULT_LIMIT = 100;
