export * from "./schema";
export { createDb } from "./client";
export { writeAuditEvent, verifyAuditChain, stableStringify, type AuditEventInput } from "./audit";
export { writeOutboxEvent, type OutboxEventInput } from "./outbox";
export { generateAccessionNumber } from "./accession";
export {
  resolveReferenceRange,
  resolveObservationRange,
  type ReferenceRangeRow,
  type ResolutionContext,
  type ResolvedRange,
  type NoRangeResult,
  type ObservationRangeParams,
  type ObservationRangeResult,
} from "./reference-range";
export { computeFlags, mergeDeltaFlag } from "./flagging";
export { resolveDeltaCheck, type DeltaCheckParams, type DeltaCheckResult } from "./delta-check";
