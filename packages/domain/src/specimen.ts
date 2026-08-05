import { z } from "zod";

/**
 * KB-22 Sample Management, TASK-047 scope (docs/plans/feat-013-accessioning-labels-reception.md,
 * revision: TASK-047): single source of truth for both request validation (nestjs-zod's
 * ZodValidationPipe) and OpenAPI generation. Mirrors packages/db/src/schema/specimen.ts's actual
 * columns/CHECK constraints exactly — never a parallel, hand-maintained list.
 */

/**
 * `specimen.specimen_type` is a plain, unconstrained `text` column (unlike
 * `status`/`rejection_reason`, both CHECK-constrained) — no catalog-driven
 * container/volume vocabulary exists yet (KB-22's own "Specimen-requirement
 * resolution" open question). Mirrors that at this layer: free text, not an
 * invented enum. See `domain/specimen-lifecycle` Skill entry #4.
 */
export const specimenTypeSchema = z.string().min(1);
export type SpecimenType = z.infer<typeof specimenTypeSchema>;

/**
 * The exact seven values `ck_specimen_rejection_reason` CHECK-constrains
 * (packages/db/src/schema/specimen.ts) — KB-22's own literal list
 * (22-sample-management.md:62). Must mirror the DB constraint exactly: a
 * mismatch would let this schema accept a value Postgres then rejects,
 * turning a 400 into a 500. See `domain/specimen-lifecycle` Skill entry #5.
 */
export const specimenRejectionReasonSchema = z.enum([
  "haemolysed",
  "clotted",
  "insufficient_volume",
  "mislabelled",
  "wrong_container",
  "improper_temperature",
  "expired",
]);
export type SpecimenRejectionReason = z.infer<
  typeof specimenRejectionReasonSchema
>;

/** Mirrors `ck_specimen_status` (packages/db/src/schema/specimen.ts) in full,
 * though TASK-047 only ever writes `accessioned`/`rejected` (revision §5) —
 * the rest are reserved for later tasks (aliquoting, analysis, reporting). */
export const specimenStatusSchema = z.enum([
  "collected",
  "received",
  "accessioned",
  "in_process",
  "completed",
  "archived",
  "disposed",
  "rejected",
]);
export type SpecimenStatus = z.infer<typeof specimenStatusSchema>;

/**
 * TASK-047 revision §5: one combined create action. Presence/absence of
 * `rejectionReason` is the accept/reject branch — an accession number is
 * assigned either way (packages/db/src/schema/specimen.ts's `NOT NULL`
 * accessionNumber, `domain/specimen-lifecycle` Skill entry #1).
 * `orderedTestIds`, if omitted, defaults server-side to every currently
 * `'ordered'` OrderedTest on `orderId` (revision §5) — not a catalog-driven
 * auto-split, a real, deliberate narrowing (Skill entry #3).
 */
export const specimenCreateSchema = z.object({
  orderId: z.uuid(),
  specimenType: specimenTypeSchema,
  orderedTestIds: z.array(z.uuid()).min(1).optional(),
  collectedAt: z.iso.datetime().optional(),
  collectionContext: z.record(z.string(), z.unknown()).optional(),
  rejectionReason: specimenRejectionReasonSchema.optional(),
});
export type SpecimenCreateInput = z.infer<typeof specimenCreateSchema>;

export const specimenSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  accessionNumber: z.string(),
  specimenType: specimenTypeSchema,
  parentSpecimenId: z.uuid().nullable(),
  status: specimenStatusSchema,
  rejectionReason: specimenRejectionReasonSchema.nullable(),
  collectionContext: z.record(z.string(), z.unknown()).nullable(),
  collectedAt: z.iso.datetime().nullable(),
  receivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  // TASK-047 revision §2: fulfilled OrderedTest ids, populated on
  // search()/getById() the same way order.ts's own `patient` summary field
  // is (TASK-044 precedent) — never a required field so create()'s
  // {resourceId, before, after} audited response, which doesn't run through
  // @ZodResponse, isn't forced to populate it.
  fulfilledOrderedTestIds: z.array(z.uuid()).optional(),
});
export type Specimen = z.infer<typeof specimenSchema>;

/**
 * Single lookup mode for TASK-047's own narrow scope (revision §10 Q1): by
 * `orderId` — the reception screen's own order-lookup fallback path when the
 * scanned/typed value isn't a specimen id itself. No free-text search mode;
 * that's the existing `/orders` search TASK-047 reuses, not a new one here.
 */
export const specimenSearchQuerySchema = z.object({
  orderId: z.uuid().optional(),
});
export type SpecimenSearchQuery = z.infer<typeof specimenSearchQuerySchema>;

/**
 * TASK-046 revision §2/§5: both barcodes encode the accession number alone
 * (KB-24 "minimise PHI... lean on the opaque accession ID") — no patient
 * name, MRN, order id, or test name anywhere in this response. Returned by
 * both `GET /v1/specimens/:id/label` (unaudited preview) and
 * `POST /v1/specimens/:id/print` (audited, §10 Q2 resolved: no reprint
 * distinction beyond the audit_event write).
 */
export const specimenLabelSchema = z.object({
  accessionNumber: z.string(),
  specimenType: specimenTypeSchema,
  receivedAt: z.iso.datetime().nullable(),
  code128Svg: z.string(),
  dataMatrixSvg: z.string(),
});
export type SpecimenLabel = z.infer<typeof specimenLabelSchema>;
