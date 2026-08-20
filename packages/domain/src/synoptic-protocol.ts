import { z } from "zod";
import { conditionNodeSchema, type ConditionNode } from "./conditions";

/**
 * FEAT-058 (ADR-0050, docs/plans/feat-058-generic-synoptic-protocol-engine.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1) — mirrors
 * packages/db/src/schema/synoptic-protocol.ts's actual columns/CHECK
 * constraints exactly.
 */

export const SYNOPTIC_ELEMENT_DATA_TYPES = ["coded", "quantity", "text", "coded_multi"] as const;
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
  // Issue #642 (proposal §3.1): a genuine gap found during that feature's
  // own implementation -- there was no way for a caller to discover which
  // version of a protocol is currently published without a direct DB query
  // (synoptic-protocol.e2e-spec.ts's own pre-existing test had to do exactly
  // that). At most one published version can ever exist per protocol
  // (ux_synoptic_protocol_version_protocol_published, a partial unique
  // index), so this is unambiguous. Null when a protocol has no published
  // version yet (draft/in_review/archived only).
  publishedVersionId: z.uuid().nullable(),
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
// Issue #645 (proposal §2/§5.1): a coded_multi element's value is a non-empty
// array of selected option values -- widened alongside the existing scalar
// string/number value, not a separate field, so every existing single-value
// caller stays unchanged.
const synopticResponseValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()).min(1),
]);

export const synopticResponseCreateSchema = z.object({
  orderedTestId: z.uuid(),
  synopticProtocolVersionId: z.uuid(),
  responses: z
    .array(
      z.object({
        elementKey: z.string().min(1),
        value: synopticResponseValueSchema,
      }),
    )
    .min(1),
});
export type SynopticResponseCreateInput = z.infer<typeof synopticResponseCreateSchema>;

export const synopticResponseResultEntrySchema = z.object({
  elementKey: z.string(),
  elementLabel: z.string(),
  value: synopticResponseValueSchema,
  observationId: z.uuid(),
});
export type SynopticResponseResultEntry = z.infer<typeof synopticResponseResultEntrySchema>;

export const synopticResponseResultSchema = z.object({
  synopticProtocolVersionId: z.uuid(),
  tableObservationId: z.uuid(),
  // Issue #662: the prior (now-superseded) grid Observation's id this
  // recording amends, or null for a first-ever recording against this
  // (orderedTestId, synopticProtocolVersionId) key.
  amendmentOf: z.uuid().nullable(),
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
  .catchall(synopticResponseValueSchema);
export type SynopticResponseRecordedEventPayload = z.infer<
  typeof synopticResponseRecordedEventPayloadSchema
>;

/**
 * Issue #659: read path for a case's already-recorded synoptic responses.
 * Reuses `synopticResponseResultEntrySchema` verbatim for `results` -- the
 * recorder's own `table`-dataType grid Observation already stores exactly
 * this shape (`synoptic-response-recorder.ts`), so the read route returns
 * it back with case/protocol-identifying fields added, not a re-derived
 * shape.
 *
 * Keyed on `(orderedTestId, synopticProtocolVersionId)`, not on a specimen/
 * part -- responses are not part-scoped in the write path today (found
 * during this issue's own implementation; tracked separately as issue
 * #674). A case with two eligible parts recorded against the *same*
 * protocol will only surface the more recent of the two here.
 */
export const caseSynopticResponseSchema = z.object({
  orderedTestId: z.uuid(),
  synopticProtocolId: z.uuid(),
  synopticProtocolVersionId: z.uuid(),
  protocolName: z.string(),
  tableObservationId: z.uuid(),
  recordedAt: z.iso.datetime(),
  // Issue #662: the prior (now-superseded) grid Observation's id this
  // current version amends, or null if it was recorded once and never
  // re-recorded. Confirms this is the real chain head (supersededBy IS
  // NULL), not just the most-recent-by-timestamp row.
  amendmentOf: z.uuid().nullable(),
  results: z.array(synopticResponseResultEntrySchema),
});
export type CaseSynopticResponse = z.infer<typeof caseSynopticResponseSchema>;

export const caseSynopticResponseListSchema = z.object({
  responses: z.array(caseSynopticResponseSchema),
});
export type CaseSynopticResponseList = z.infer<
  typeof caseSynopticResponseListSchema
>;

// Re-exported for callers that only need the condition-tree type alongside
// synoptic-protocol types (mirrors report-template.ts's own precedent).
export type { ConditionNode };
