import { z } from "zod";

/**
 * FEAT-034 (docs/plans/feat-034-operational-reports-tat-workload.md).
 * `from`/`to` are both required (proposal §5) -- unlike `order.controller.ts`'s
 * own optional `createdFrom`/`createdTo` pair, an aggregate report has no
 * sane "all time" default at real data volume.
 */
export const operationalReportQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
export type OperationalReportQuery = z.infer<typeof operationalReportQuerySchema>;

/**
 * TAT is scoped to `ordered_test` (KB-02's own "chemistry = per panel"
 * reporting unit, already resolved by TASK-059, reused here rather than
 * re-litigated). `withinTargetPct` is only meaningful per-priority --
 * `sla_target` is keyed by priority, not by test -- hence two different row
 * shapes rather than one generic "group" shape.
 */
export const tatByPriorityEntrySchema = z.object({
  priority: z.string(),
  count: z.number(),
  meanMinutes: z.number(),
  medianMinutes: z.number(),
  withinTargetPct: z.number().nullable(),
});
export type TatByPriorityEntry = z.infer<typeof tatByPriorityEntrySchema>;

export const tatByTestEntrySchema = z.object({
  testDefinitionId: z.uuid(),
  testDisplayName: z.string(),
  count: z.number(),
  meanMinutes: z.number(),
  medianMinutes: z.number(),
});
export type TatByTestEntry = z.infer<typeof tatByTestEntrySchema>;

export const tatReportSchema = z.object({
  byPriority: z.array(tatByPriorityEntrySchema),
  byTest: z.array(tatByTestEntrySchema),
});
export type TatReport = z.infer<typeof tatReportSchema>;

/**
 * Per observation, not per ordered_test -- "workload by bench/analyst" is
 * naturally per-result (proposal §5). No name resolution (`userId` is the
 * raw id) -- no user table exists yet (M2), matching every other identity
 * display in this codebase (e.g. `report-assembly.ts`'s own verifier
 * block).
 */
export const workloadEntrySchema = z.object({
  userId: z.string(),
  operatorCount: z.number(),
  verifierCount: z.number(),
});
export type WorkloadEntry = z.infer<typeof workloadEntrySchema>;

export const workloadReportSchema = z.object({
  entries: z.array(workloadEntrySchema),
});
export type WorkloadReport = z.infer<typeof workloadReportSchema>;

/**
 * `totalSpecimens` is the real denominator for a rate, not just a raw
 * rejected count (proposal §7's own literal AC).
 */
export const rejectionRateEntrySchema = z.object({
  reason: z.string(),
  count: z.number(),
});
export type RejectionRateEntry = z.infer<typeof rejectionRateEntrySchema>;

export const rejectionRateReportSchema = z.object({
  totalSpecimens: z.number(),
  rejectedTotal: z.number(),
  byReason: z.array(rejectionRateEntrySchema),
});
export type RejectionRateReport = z.infer<typeof rejectionRateReportSchema>;
