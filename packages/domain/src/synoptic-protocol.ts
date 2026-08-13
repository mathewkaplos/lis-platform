import { z } from "zod";
import { conditionNodeSchema, type ConditionNode } from "./conditions";

/**
 * FEAT-058 (ADR-0050, docs/plans/feat-058-generic-synoptic-protocol-engine.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1) — mirrors
 * packages/db/src/schema/synoptic-protocol.ts's actual columns/CHECK
 * constraints exactly.
 */

export const SYNOPTIC_ELEMENT_DATA_TYPES = ["coded", "quantity", "text"] as const;
export type SynopticElementDataType = (typeof SYNOPTIC_ELEMENT_DATA_TYPES)[number];

export const SYNOPTIC_ELEMENT_REQUIREMENTS = ["required", "recommended"] as const;
export type SynopticElementRequirement = (typeof SYNOPTIC_ELEMENT_REQUIREMENTS)[number];

export const synopticElementResponseOptionSchema = z.object({
  id: z.uuid(),
  value: z.string(),
  display: z.string(),
  displayOrder: z.number().int(),
});
export type SynopticElementResponseOption = z.infer<typeof synopticElementResponseOptionSchema>;

export const synopticElementSchema = z.object({
  id: z.uuid(),
  synopticProtocolVersionId: z.uuid(),
  parentElementId: z.uuid().nullable(),
  key: z.string(),
  label: z.string(),
  dataType: z.enum(SYNOPTIC_ELEMENT_DATA_TYPES),
  requirement: z.enum(SYNOPTIC_ELEMENT_REQUIREMENTS),
  analyteId: z.uuid(),
  visibilityCondition: conditionNodeSchema.nullable(),
  displayOrder: z.number().int(),
  responseOptions: z.array(synopticElementResponseOptionSchema),
});
export type SynopticElement = z.infer<typeof synopticElementSchema>;

export const SYNOPTIC_PROTOCOL_VERSION_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type SynopticProtocolVersionStatus = (typeof SYNOPTIC_PROTOCOL_VERSION_STATUSES)[number];

export const synopticProtocolVersionSchema = z.object({
  id: z.uuid(),
  synopticProtocolId: z.uuid(),
  version: z.number().int(),
  status: z.enum(SYNOPTIC_PROTOCOL_VERSION_STATUSES),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
  elements: z.array(synopticElementSchema),
});
export type SynopticProtocolVersion = z.infer<typeof synopticProtocolVersionSchema>;

export const synopticProtocolSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sourceStandard: z.string(),
  specimenType: z.string(),
  createdAt: z.iso.datetime(),
});
export type SynopticProtocol = z.infer<typeof synopticProtocolSchema>;

export const synopticProtocolListSchema = z.object({
  protocols: z.array(synopticProtocolSchema),
});
export type SynopticProtocolList = z.infer<typeof synopticProtocolListSchema>;

/**
 * ADR-0050 §Decision 4: recording a case's synoptic responses. One
 * `{ elementKey, value }` pair per element the caller is providing a value
 * for -- omitted `required` elements (that aren't hidden by an unmet
 * `visibilityCondition`) are rejected at record time (proposal §8).
 */
export const synopticResponseCreateSchema = z.object({
  orderedTestId: z.uuid(),
  synopticProtocolVersionId: z.uuid(),
  responses: z
    .array(
      z.object({
        elementKey: z.string().min(1),
        value: z.union([z.string(), z.number()]),
      }),
    )
    .min(1),
});
export type SynopticResponseCreateInput = z.infer<typeof synopticResponseCreateSchema>;

export const synopticResponseResultEntrySchema = z.object({
  elementKey: z.string(),
  elementLabel: z.string(),
  value: z.union([z.string(), z.number()]),
  observationId: z.uuid(),
});
export type SynopticResponseResultEntry = z.infer<typeof synopticResponseResultEntrySchema>;

export const synopticResponseResultSchema = z.object({
  synopticProtocolVersionId: z.uuid(),
  tableObservationId: z.uuid(),
  results: z.array(synopticResponseResultEntrySchema),
});
export type SynopticResponseResult = z.infer<typeof synopticResponseResultSchema>;

/**
 * FEAT-064 (docs/plans/feat-064-cytology-reflex-ascus-hpv.md). `SynopticResponseRecorded`
 * outbox event payload -- emitted unconditionally by `assembleAndPersistSynopticResponse`
 * for every protocol (ADR-0050 §Decision 4's own protocol-agnostic-writer invariant),
 * so unlike `cultureGrowthDetectedEventPayloadSchema`'s own two fixed fields, the response
 * entries here are genuinely open-ended, protocol-defined element keys -- `.catchall()`
 * admits any of them at the top level (workflow-condition-evaluator.ts's `context[node.field]`
 * lookup is flat, never nested, which is why these aren't wrapped under a `responses` key).
 */
export const synopticResponseRecordedEventPayloadSchema = z
  .object({ orderedTestId: z.uuid() })
  .catchall(z.union([z.string(), z.number()]));
export type SynopticResponseRecordedEventPayload = z.infer<
  typeof synopticResponseRecordedEventPayloadSchema
>;

// Re-exported for callers that only need the condition-tree type alongside
// synoptic-protocol types (mirrors report-template.ts's own precedent).
export type { ConditionNode };
