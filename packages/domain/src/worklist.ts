import { z } from "zod";
import { orderedTestStatusSchema, orderPatientSummarySchema, orderPrioritySchema } from "./order";

/**
 * FEAT-017/TASK-061 (docs/plans/feat-017-minimal-worklist.md): a live query
 * over `ordered_test` rows, not a stored worklist/task record (KB-26's
 * "worklist" half only — no Task-record/assignment/SLA-escalation concept).
 * New file, not folded into order.ts, per order.ts's own comment
 * anticipating this ("that's worklist-level (FEAT-017+)").
 */

/** §10 Q1 (approved): the 3 counted stages map onto ordered_test's real,
 * already-written status values -- 'pending' groups 'ordered' + 'received'
 * (result entry not yet started), 'in-progress' is 'in_process', 'verified'
 * is 'resulted' (already means every analyte finalized and every critical
 * acknowledged, per Constitution Law #3 enforcement in
 * FinalizationRollupInterceptor). 'cancelled'/'rejected' are excluded from
 * every bucket. */
export const worklistStageSchema = z.enum(["pending", "in_progress", "verified"]);
export type WorklistStage = z.infer<typeof worklistStageSchema>;

export const worklistCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
});
export type WorklistCounts = z.infer<typeof worklistCountsSchema>;

/**
 * §10 Q1/Q3 (approved): `stage` filters to one of the 3 counted buckets;
 * `status` optionally narrows to one exact ordered_test.status value
 * (including 'cancelled'/'rejected', which the default query excludes --
 * this is the "optional status filter to include them" Q3 resolved for).
 * Both combine with AND, same as `priority`/`createdFrom`/`createdTo`,
 * mirroring orderSearchQuerySchema's shape.
 */
export const worklistQuerySchema = z.object({
  stage: worklistStageSchema.optional(),
  status: orderedTestStatusSchema.optional(),
  priority: orderPrioritySchema.optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
});
export type WorklistQuery = z.infer<typeof worklistQuerySchema>;

/** §10 Q2 (approved): computed elapsed-time only, no stored SLA/target
 * concept -- minutes since `createdAt`. */
export const worklistItemSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  testDefinitionId: z.uuid(),
  testDisplayName: z.string(),
  status: orderedTestStatusSchema,
  priority: orderPrioritySchema,
  patient: orderPatientSummarySchema,
  createdAt: z.iso.datetime(),
  ageMinutes: z.number().int().nonnegative(),
});
export type WorklistItem = z.infer<typeof worklistItemSchema>;

/** §10 Q4 (approved): one combined response, not two routes -- a
 * landing-page load needs both counts and rows on first paint. */
export const worklistResponseSchema = z.object({
  counts: worklistCountsSchema,
  items: z.array(worklistItemSchema),
});
export type WorklistResponse = z.infer<typeof worklistResponseSchema>;

/** Same fixed-cap-no-cursor-pagination precedent as
 * ORDER_SEARCH_RESULT_LIMIT (engineering/api-design entry #4, ADR-0013
 * §Decision 4). */
export const WORKLIST_RESULT_LIMIT = 100;
