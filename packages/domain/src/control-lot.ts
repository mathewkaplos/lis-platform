import { z } from "zod";
import { resultEntryDataTypeSchema, resultEntrySchema } from "./observation";

/**
 * TASK-064 (FEAT-018 revision, docs/plans/feat-018-qc-materials-results-as-observations.md):
 * QC result entry reuses the exact same request shape TASK-051 already
 * built for patient results (`resultEntrySchema` -- quantity/coded/text,
 * discriminated on `dataType`) rather than defining a parallel one. Control
 * lots carry no reference-range/flagging concept (KB-27's Westgard
 * evaluation is FEAT-019's own later scope, not this task's), so the
 * response shape below is deliberately smaller than `observationSchema` --
 * no refLow/refHigh/flags/status fields a QC row never meaningfully has yet.
 */
export const qcResultEntrySchema = resultEntrySchema;
export type QcResultEntryInput = z.infer<typeof qcResultEntrySchema>;

/**
 * Response shape for a QC observation -- `controlLotId`, not `orderedTestId`/
 * `patientId` (ADR-0015: these rows have neither). Every POST creates a new
 * row (proposal §5): a control lot's QC history is a time series of
 * measurements, not a single upsertable "current result" the way a patient
 * ordered-test analyte is -- so there is no draft/finalize/status lifecycle
 * here, unlike `observationSchema`.
 */
export const qcObservationSchema = z
  .object({
    id: z.uuid(),
    controlLotId: z.uuid(),
    analyteId: z.uuid(),
    dataType: resultEntryDataTypeSchema,
    valueNum: z.number().nullable(),
    valueCode: z.string().nullable(),
    valueText: z.string().nullable(),
    unit: z.string().nullable(),
    source: z.string(),
    producedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "QcObservationDto" });
export type QcObservationResult = z.infer<typeof qcObservationSchema>;

/**
 * TASK-067 (FEAT-019, ADR-0018): a Westgard rule violation detected against
 * a QC observation, in the same transaction as its insert. TASK-070
 * (ADR-0019 Decision 3) adds the resolve lifecycle -- resolvedAt/
 * resolvedByUserId, null until a `qa`-role user calls
 * `POST /v1/qc-rule-violations/:id/resolve`, mirroring
 * `criticalNotificationSchema`'s own acknowledgedAt/acknowledgedByUserId
 * precedent exactly.
 */
export const qcRuleViolationSchema = z
  .object({
    id: z.uuid(),
    controlLotId: z.uuid(),
    observationId: z.uuid(),
    ruleCode: z.enum(["1_2s", "1_3s", "2_2s", "r_4s", "4_1s", "10x"]),
    severity: z.enum(["warning", "rejection"]),
    detectedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
    resolvedByUserId: z.uuid().nullable(),
  })
  .meta({ id: "QcRuleViolationDto" });
export type QcRuleViolationResult = z.infer<typeof qcRuleViolationSchema>;

/**
 * TASK-070 (FEAT-020, proposal §10 Q2, folding in issue #381): the minimal
 * violation-list screen's own row shape -- `qcRuleViolationSchema` plus
 * `analyteId`, denormalized from the violation's own `control_lot` join
 * (`GET /v1/qc-rule-violations`). Deliberately just the id, not a joined
 * display name -- the frontend already fetches `/v1/catalog` separately for
 * `control-lots/[id]/chart/page.tsx`'s own analyte-display lookup; this
 * reuses that exact same precedent rather than duplicating catalog logic in
 * a second endpoint.
 */
export const qcRuleViolationListItemSchema = qcRuleViolationSchema.extend({
  analyteId: z.uuid(),
});
export type QcRuleViolationListItem = z.infer<
  typeof qcRuleViolationListItemSchema
>;

/**
 * TASK-068 (FEAT-019 revision): one Levey-Jennings chart point -- an
 * ordinary QC observation plus its own z-score (KB-27's "value, target, SD,
 * z-score, rules triggered" table, Stitch §14.2) and every violation
 * TASK-067 detected for it (Stitch §14.4: "Westgard-rule violations
 * annotated on the offending points"). Ordered oldest -> newest by the
 * endpoint itself, not this schema -- a chart reads left-to-right
 * chronologically, deliberately the reverse of `listResults`' own
 * most-recent-first convention (a different consumer, not an inconsistency).
 */
export const qcChartPointSchema = z
  .object({
    id: z.uuid(),
    value: z.number(),
    zScore: z.number(),
    producedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    violations: z.array(qcRuleViolationSchema),
  })
  .meta({ id: "QcChartPointDto" });
export type QcChartPointResult = z.infer<typeof qcChartPointSchema>;

/**
 * The full Levey-Jennings chart for one control lot: the mean/SD band a
 * chart plots as shaded regions (KB-27: "control values plotted against
 * mean ± 1/2/3 SD"), plus the ordered points. Quantity-only -- a chart
 * against a mean/SD is meaningless for a coded/text control lot, the same
 * boundary TASK-067's own evaluator already draws (§5, `evaluateAndPersistViolations`).
 */
export const qcChartSchema = z
  .object({
    controlLotId: z.uuid(),
    analyteId: z.uuid(),
    level: z.string(),
    targetMean: z.number(),
    targetSd: z.number(),
    points: z.array(qcChartPointSchema),
  })
  .meta({ id: "QcChartDto" });
export type QcChartResult = z.infer<typeof qcChartSchema>;
