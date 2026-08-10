import { z } from "zod";
import { orderPrioritySchema } from "./order";

/**
 * `apps/interop`'s internal order-ingest payload (FEAT-036, ADR-0034/
 * ADR-0035) -- the ACL's already-parsed shape from an inbound HL7 ORM^O01,
 * not the wire format itself. Deliberately not `orderCreateSchema`
 * (`order.ts`): that schema takes a real `patientId` UUID and
 * `testDefinitionId`/`panelId` UUIDs a human's browser session already
 * resolved client-side; an HL7 message only ever carries an MRN (PID.3) and
 * test codes (OBR.4.1) -- resolving those to real UUIDs is
 * `apps/api`'s own correlation step (`InteropOrderCorrelationService`),
 * mirroring how `AnalyzerCorrelationService` resolves a raw analyzer
 * result's specimen/channel strings, not something the ACL does itself.
 *
 * v1 scope: exactly one test code per message (single-OBR ORM only) --
 * multi-OBR (one message ordering several tests at once) is a real,
 * deliberately deferred follow-up, not silently assumed solved (no
 * confirmed design-partner message profile exists yet to shape it against,
 * same reasoning FEAT-027 used for its own still-unbuilt real instrument
 * driver).
 */
export const interopOrderIngestSchema = z.object({
  mrn: z.string().min(1),
  testCode: z.string().min(1),
  priority: orderPrioritySchema.optional(),
  rawMessage: z.string(),
});
export type InteropOrderIngestInput = z.infer<
  typeof interopOrderIngestSchema
>;
