import { z } from "zod";

/**
 * TASK-065 (FEAT-021, docs/plans/feat-021-critical-notification-read-back-escalation.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1), same as every other domain file.
 */

export const criticalNotificationStatusSchema = z.enum([
  "pending",
  "acknowledged",
  "escalated",
]);
export type CriticalNotificationStatus = z.infer<
  typeof criticalNotificationStatusSchema
>;

/** `POST /v1/critical-notifications/:id/acknowledge` request body -- the
 * documented read-back Constitution Law #3 requires. Non-empty, enforced
 * by the writer (ADR-0016), not a blanket presence check alone -- an
 * all-whitespace string would satisfy `min(1)` on its own, so this trims
 * first. */
export const acknowledgeCriticalNotificationSchema = z.object({
  readBack: z.string().trim().min(1),
});
export type AcknowledgeCriticalNotificationInput = z.infer<
  typeof acknowledgeCriticalNotificationSchema
>;

export const criticalNotificationSchema = z
  .object({
    id: z.uuid(),
    observationId: z.uuid(),
    status: criticalNotificationStatusSchema,
    createdAt: z.iso.datetime(),
    escalationLevel: z.number().int(),
    lastEscalatedAt: z.iso.datetime().nullable(),
    acknowledgedAt: z.iso.datetime().nullable(),
    acknowledgedByUserId: z.uuid().nullable(),
    readBack: z.string().nullable(),
  })
  .meta({ id: "CriticalNotificationDto" });
export type CriticalNotificationResult = z.infer<
  typeof criticalNotificationSchema
>;
