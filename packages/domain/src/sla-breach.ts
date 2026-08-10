import { z } from "zod";

/**
 * FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md):
 * single source of truth for both request validation and OpenAPI
 * generation (engineering/api-design Skill entry #1), same as every other
 * domain file.
 */

export const slaBreachStatusSchema = z.enum(["pending", "escalated", "resolved"]);
export type SlaBreachStatus = z.infer<typeof slaBreachStatusSchema>;

export const slaBreachSchema = z.object({
  id: z.uuid(),
  orderedTestId: z.uuid(),
  priority: z.enum(["routine", "stat"]),
  targetMinutes: z.number().int(),
  breachedAt: z.iso.datetime(),
  status: slaBreachStatusSchema,
  escalationLevel: z.number().int(),
  lastEscalatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type SlaBreachResult = z.infer<typeof slaBreachSchema>;

export const slaBreachListQuerySchema = z.object({
  status: slaBreachStatusSchema.optional(),
});
export type SlaBreachListQuery = z.infer<typeof slaBreachListQuerySchema>;

/**
 * `SlaBreached` outbox event payload (`apps/api/src/sla/sla-breach-detector
 * .service.ts`) -- also this engine's condition-evaluator context, hence
 * `priority`/`targetMinutes` in `workflow-types.ts`'s own `ALLOWED_FIELDS`.
 */
export const slaBreachedEventPayloadSchema = z.object({
  orderedTestId: z.uuid(),
  priority: z.enum(["routine", "stat"]),
  targetMinutes: z.number().int(),
});
export type SlaBreachedEventPayload = z.infer<
  typeof slaBreachedEventPayloadSchema
>;
