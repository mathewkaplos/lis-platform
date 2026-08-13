import { z } from "zod";
import { specimenRejectionReasonSchema, specimenTypeSchema } from "./specimen";

/**
 * FEAT-057 (ADR-0049, docs/plans/feat-057-case-specimen-block-slide-hierarchy.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1) — mirrors
 * packages/db/src/schema/anatomic-pathology.ts's actual columns/CHECK
 * constraints exactly.
 */

/** Mirrors `ck_case_status`. `signed_out` is set by the real, step-up-signed
 * `finalize` action (FEAT-059); `amended` is set by `amend`. `pending_review`
 * (FEAT-063, docs/plans/feat-063-cytology-two-tier-workflow.md) is set by the
 * new `screen` action, only reachable for a case that
 * `requiresTwoTierReview` -- `finalize` then requires this status instead of
 * `in_process` for such a case (AC #1). A case that does not require two-tier
 * review never passes through `pending_review` at all. */
export const caseStatusSchema = z.enum(["accessioned", "in_process", "pending_review", "signed_out", "amended"]);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

/** Mirrors `ck_block_status`/`ck_slide_status` — a minimal active/disposed
 * marker, not the full grossing/processing/staining state machine (KB-17),
 * which is real future work for a later M13 feature. */
export const anatomicPathologyItemStatusSchema = z.enum(["active", "disposed"]);
export type AnatomicPathologyItemStatus = z.infer<typeof anatomicPathologyItemStatusSchema>;

/**
 * One combined create action, mirroring specimenCreateSchema's own "one
 * combined create action" shape (domain/specimen-lifecycle Skill entry #2):
 * a Case is created with all of its specimen/parts in a single request, in
 * one transaction (proposal §2). `rejectionReason`'s presence/absence per
 * part is the accept/reject branch, same as specimen's own convention.
 */
export const caseCreatePartSchema = z.object({
  specimenType: specimenTypeSchema,
  rejectionReason: specimenRejectionReasonSchema.optional(),
});
export type CaseCreatePart = z.infer<typeof caseCreatePartSchema>;

export const caseCreateSchema = z.object({
  orderId: z.uuid(),
  parts: z.array(caseCreatePartSchema).min(1),
});
export type CaseCreateInput = z.infer<typeof caseCreateSchema>;

export const caseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  orderId: z.uuid(),
  accessionNumber: z.string(),
  status: caseStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Case = z.infer<typeof caseSchema>;

export const blockCreateSchema = z.object({
  specimenId: z.uuid(),
});
export type BlockCreateInput = z.infer<typeof blockCreateSchema>;

export const blockSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  specimenId: z.uuid(),
  blockNumber: z.number().int().positive(),
  code: z.string(),
  status: anatomicPathologyItemStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Block = z.infer<typeof blockSchema>;

export const slideSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  blockId: z.uuid(),
  slideNumber: z.number().int().positive(),
  code: z.string(),
  status: anatomicPathologyItemStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Slide = z.infer<typeof slideSchema>;

/**
 * ADR-0049 §Decision 4: a reflex/add-on stain creates a new OrderedTest on an
 * existing block, never a new Case or Specimen row. `parentOrderedTestId` is
 * optional — reuses FEAT-030's existing reflex-lineage self-FK when this
 * add-on is triggered from a specific prior test, but a block can also gain
 * a manually-requested add-on test with no lineage parent.
 */
export const blockOrderedTestLinkCreateSchema = z.object({
  testDefinitionId: z.uuid(),
  parentOrderedTestId: z.uuid().optional(),
});
export type BlockOrderedTestLinkCreateInput = z.infer<typeof blockOrderedTestLinkCreateSchema>;

/** Full case → part → block → slide lineage in one response (AC #2), each
 * block annotated with the OrderedTest ids fulfilled on it (via
 * block_fulfillment) so a reflex/add-on stain is visible in the same tree. */
export const caseLineageBlockSchema = z.object({
  ...blockSchema.shape,
  orderedTestIds: z.array(z.uuid()),
  slides: z.array(slideSchema),
});
export type CaseLineageBlock = z.infer<typeof caseLineageBlockSchema>;

export const caseLineagePartSchema = z.object({
  id: z.uuid(),
  accessionNumber: z.string(),
  specimenType: specimenTypeSchema,
  status: z.string(),
  blocks: z.array(caseLineageBlockSchema),
});
export type CaseLineagePart = z.infer<typeof caseLineagePartSchema>;

export const caseLineageSchema = z.object({
  ...caseSchema.shape,
  parts: z.array(caseLineagePartSchema),
});
export type CaseLineage = z.infer<typeof caseLineageSchema>;

/**
 * FEAT-059 (ADR-0051, docs/plans/feat-059-sign-out-step-up-digital-signature.md).
 * Mirrors `packages/db/src/schema/anatomic-pathology.ts`'s `caseReportVersion`
 * table. `signature` is hex-encoded for JSON transport (the DB column is
 * `bytea`) — a caller who needs to verify it converts back via
 * `Buffer.from(signature, "hex")` and `verifyCaseReportSignature`
 * (`@lis/db`).
 */
export const caseReportVersionStatusSchema = z.enum(["final", "superseded"]);
export type CaseReportVersionStatus = z.infer<typeof caseReportVersionStatusSchema>;

export const caseReportVersionSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  caseId: z.uuid(),
  versionNumber: z.number().int().positive(),
  contentHash: z.string(),
  signature: z.string(),
  signedByUserId: z.uuid(),
  signedByRole: z.string(),
  authTimeUsed: z.iso.datetime(),
  amendmentOf: z.uuid().nullable(),
  reason: z.string().nullable(),
  supersededBy: z.uuid().nullable(),
  status: caseReportVersionStatusSchema,
  signedAt: z.iso.datetime(),
});
export type CaseReportVersion = z.infer<typeof caseReportVersionSchema>;

/** `POST /v1/cases/:id/amend` body (AC #3): a `reason` is mandatory for
 * every amendment, matching `audit_event.reason`'s own "required for
 * amendments" convention. */
export const caseAmendRequestSchema = z.object({
  reason: z.string().min(1),
});
export type CaseAmendRequestInput = z.infer<typeof caseAmendRequestSchema>;

/**
 * FEAT-063 (docs/plans/feat-063-cytology-two-tier-workflow.md, §10 Q3/Q4).
 * `GET /v1/cases` -- a live query over `case.status` (KB-26's "worklist"
 * half, mirroring `worklistQuerySchema`'s own shape), not a stored Task
 * record. No `status` filter returns every case NOT in a terminal state
 * (`signed_out`/`amended` excluded by default, matching
 * `worklist.controller.ts`'s own `ACTIVE_STATUSES` precedent) -- an explicit
 * `status` value overrides that default entirely, including to a terminal
 * one. Reuses `caseSchema` directly for items rather than a narrower
 * projection: this repo's own "reuse before inventing" precedent, and every
 * field on `Case` is already worklist-relevant (id, accessionNumber, status,
 * createdAt).
 */
export const caseListQuerySchema = z.object({
  status: caseStatusSchema.optional(),
});
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

export const caseListResponseSchema = z.object({
  items: z.array(caseSchema),
});
export type CaseListResponse = z.infer<typeof caseListResponseSchema>;
