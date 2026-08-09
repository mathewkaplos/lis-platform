import { z } from "zod";
import { orderedTestStatusSchema, orderPatientSummarySchema, orderPrioritySchema } from "./order";

/** Same fixed-cap-no-cursor-pagination precedent as
 * ORDER_SEARCH_RESULT_LIMIT (engineering/api-design entry #4, ADR-0013
 * §Decision 4). Declared up top (moved from the file's original end position
 * by FEAT-022) so the bulk schemas below can reference it as their own
 * array-size cap -- reusing the existing limit rather than inventing a
 * second one, per FEAT-022 proposal §5. */
export const WORKLIST_RESULT_LIMIT = 100;

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

/** FEAT-022 Part 1 (ADR-0024 / proposal §10 Q2): `on_track`/`at_risk`/
 * `overdue`, computed at read time from `ageMinutes` vs. the row's own
 * priority's `sla_target.targetMinutes` -- `at_risk` is a fixed 80% ratio of
 * the target, not a second stored threshold column (§10 Q2 resolution). */
export const worklistSlaStatusSchema = z.enum(["on_track", "at_risk", "overdue"]);
export type WorklistSlaStatus = z.infer<typeof worklistSlaStatusSchema>;

/** Fixed 80% ratio of the target, not a second stored threshold column
 * (proposal §10 Q2). */
const AT_RISK_RATIO = 0.8;

/**
 * Pure, directly unit-testable (no DB access) -- mirrors `computeFlags`'s
 * own precedent (`packages/db/src/flagging.ts`) of a plain exported
 * function rather than a private controller method, so this repo's usual
 * "test the resolver directly" pattern applies here too. No configured
 * target for a priority never fabricates a status -- `on_track`, the same
 * "no_range... never silently treated as normal" discipline
 * `reference-range.ts` established. Boundary inclusive (mirrors
 * `flagging.ts`'s own precedent): exactly at the target is already
 * `overdue`, exactly at the 80% at-risk threshold is already `at_risk`.
 */
export function computeSlaStatus(ageMinutes: number, targetMinutes: number | undefined): WorklistSlaStatus {
  if (targetMinutes === undefined) return "on_track";
  if (ageMinutes >= targetMinutes) return "overdue";
  if (ageMinutes >= targetMinutes * AT_RISK_RATIO) return "at_risk";
  return "on_track";
}

/** §10 Q2 (approved, FEAT-017): computed elapsed-time only, no stored SLA/
 * target concept on the item itself -- minutes since `createdAt`.
 * `slaStatus`/`assignedUserId` added by FEAT-022 Part 1. */
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
  slaStatus: worklistSlaStatusSchema,
  // ADR-0024: no FK, unvalidated against any directory (none exists) -- null
  // means unassigned. Set only via POST /v1/worklist/bulk-assign.
  assignedUserId: z.uuid().nullable(),
});
export type WorklistItem = z.infer<typeof worklistItemSchema>;

/** §10 Q4 (approved): one combined response, not two routes -- a
 * landing-page load needs both counts and rows on first paint. */
export const worklistResponseSchema = z.object({
  counts: worklistCountsSchema,
  items: z.array(worklistItemSchema),
});
export type WorklistResponse = z.infer<typeof worklistResponseSchema>;

/**
 * FEAT-022 Part 1 (ADR-0024): bulk-assign accepts any uuid -- unvalidated
 * against a directory, since none exists (finding #1). `assignedUserId:
 * null` clears the assignment (bulk-unassign), a real, explicit case, not
 * an omitted/optional field (proposal §7 AC: "ids that don't resolve... are
 * reported back, not silently dropped").
 */
export const worklistBulkAssignSchema = z.object({
  orderedTestIds: z.array(z.uuid()).min(1).max(WORKLIST_RESULT_LIMIT),
  assignedUserId: z.uuid().nullable(),
});
export type WorklistBulkAssignInput = z.infer<typeof worklistBulkAssignSchema>;

export const worklistBulkAssignResponseSchema = z.object({
  updatedIds: z.array(z.uuid()),
  notFoundIds: z.array(z.uuid()),
});
export type WorklistBulkAssignResult = z.infer<typeof worklistBulkAssignResponseSchema>;

/**
 * FEAT-022 Part 1 (proposal §1 finding #2): deliberately NOT a generic
 * `toStatus` field -- the only status transition with no real domain side
 * effect to bypass is cancel, so bulk-cancel is its own narrow action, not
 * a generic bulk-transition endpoint that could be pointed at 'resulted'/
 * 'verified' and skip the real checks those transitions require elsewhere.
 */
export const worklistBulkCancelSchema = z.object({
  orderedTestIds: z.array(z.uuid()).min(1).max(WORKLIST_RESULT_LIMIT),
});
export type WorklistBulkCancelInput = z.infer<typeof worklistBulkCancelSchema>;

export const worklistBulkCancelResponseSchema = z.object({
  cancelledIds: z.array(z.uuid()),
  ineligibleIds: z.array(z.uuid()),
});
export type WorklistBulkCancelResult = z.infer<typeof worklistBulkCancelResponseSchema>;
