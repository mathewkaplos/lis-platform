import { z } from "zod";

/**
 * FEAT-052 (docs/plans/feat-052-culture-workflow-reflex-cascade.md,
 * ADR-0046): single source of truth for both request validation and OpenAPI
 * generation, same as every other domain file.
 */

export const cultureReadResultSchema = z.enum(["no_growth", "growth"]);
export type CultureReadResult = z.infer<typeof cultureReadResultSchema>;

export const cultureReadSchema = z.object({
  id: z.uuid(),
  orderedTestId: z.uuid(),
  scheduledAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  result: cultureReadResultSchema.nullable(),
  recordedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type CultureReadResponse = z.infer<typeof cultureReadSchema>;

// POST /v1/ordered-tests/:orderedTestId/culture-reads -- schedules the
// culture's one v1 read (proposal §5/§10 Q2: single-read scope). scheduledAt
// optional -- defaults server-side to now + 18h (a placeholder standard
// incubation window, same "placeholder, not partner-validated" framing every
// other clinical-adjacent constant in this codebase already carries, e.g.
// sla-targets.sql's own turnaround minutes).
export const scheduleCultureReadSchema = z.object({
  scheduledAt: z.iso.datetime().optional(),
});
export type ScheduleCultureReadInput = z.infer<typeof scheduleCultureReadSchema>;

// POST /v1/culture-reads/:id/record -- always a human-initiated action
// (ADR-0046 decision 4), never something the detector or engine calls.
export const recordCultureReadSchema = z.object({
  result: cultureReadResultSchema,
});
export type RecordCultureReadInput = z.infer<typeof recordCultureReadSchema>;

// `CultureGrowthDetected` outbox event payload -- emitted only when a
// recorded result is 'growth' (the record handler's own decision, mirroring
// SlaBreachDetectorService's "only emit once a real breach is detected"
// precedent), never for 'no_growth'. The workflow_definition rule that
// dispatches AddReflexTest off this event conditions on `result` purely for
// clarity/consistency with every other rule's own expressive `when`, not
// because the event's mere existence is itself ambiguous.
export const cultureGrowthDetectedEventPayloadSchema = z.object({
  orderedTestId: z.uuid(),
  result: z.literal("growth"),
});
export type CultureGrowthDetectedEventPayload = z.infer<
  typeof cultureGrowthDetectedEventPayloadSchema
>;

// `CultureReadDue` outbox event payload -- emitted by
// CultureReadDueDetectorService once per due, not-yet-notified culture_read
// row (ADR-0046 decision 2). No command handler consumes this yet (no
// notification feature exists in this scope) -- the audited fact-of-record
// is the point, same as CriticalNotificationEscalationService's own audit
// trail stands on its own regardless of downstream consumers.
export const cultureReadDueEventPayloadSchema = z.object({
  cultureReadId: z.uuid(),
  orderedTestId: z.uuid(),
  scheduledAt: z.iso.datetime(),
});
export type CultureReadDueEventPayload = z.infer<
  typeof cultureReadDueEventPayloadSchema
>;
