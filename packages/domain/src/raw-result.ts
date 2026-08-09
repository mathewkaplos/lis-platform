import { z } from "zod";

/**
 * The edge integration gateway's common ingestion port payload shape
 * (KB-29 "common raw result shape", FEAT-026). Deliberately generic — a
 * real instrument driver (FEAT-027) maps its own dialect (ASTM/HL7/
 * POCT1-A2) into this shape before calling the gateway's `POST /ingest`; a
 * synthetic/mock driver calls it directly. `rawPayload` carries the
 * original, unparsed message verbatim (KB-29 step 1: "persist the raw
 * payload verbatim before any parsing").
 *
 * Shared between apps/gateway (produces it) and apps/api (consumes it at
 * the internal ingestion endpoint) so both sides derive the same
 * idempotency key from the same fields — never duplicated independently.
 */
export const rawResultSchema = z.object({
  instrumentId: z.string().min(1),
  specimenId: z.string().min(1),
  analyte: z.string().min(1),
  runId: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  flag: z.string().optional(),
  rawPayload: z.string(),
});

export type RawResult = z.infer<typeof rawResultSchema>;

/** KB-29's dedup key: `(instrument_id, specimen_id, analyte, run_id)`. */
export function rawResultIdempotencyKey(
  r: Pick<RawResult, "instrumentId" | "specimenId" | "analyte" | "runId">,
): string {
  return `${r.instrumentId}:${r.specimenId}:${r.analyte}:${r.runId}`;
}
