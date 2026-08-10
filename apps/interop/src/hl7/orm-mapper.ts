import type { InteropOrderIngestInput } from '@lis/domain';
import { Message } from 'node-hl7-client';

/**
 * A well-formed HL7 message that is still missing a field this ACL requires
 * to even attempt correlation (PID.3, OBR.4) -- distinct from an
 * `unknown_mrn`/`unknown_test_code` *unmatched* result (KB-29/KB-30's "park,
 * never drop", apps/api's own 422). A malformed message can't be parked for
 * correlation at all; the inbound handler (`orm-inbound.service.ts`) maps
 * this to an HL7 "AE" (Application Error) ACK, not "AR".
 */
export class OrmMappingError extends Error {}

/**
 * Translates a parsed ORM^O01 `Message` into `apps/api`'s
 * `interopOrderIngestSchema` shape (FEAT-036, KB-30's PID/OBR mapping).
 *
 * v1 scope, deliberately narrow (no confirmed design-partner message profile
 * exists yet -- same reasoning FEAT-027 used for its own still-unbuilt real
 * instrument driver):
 * - Exactly **one** OBR per message (one ordered test). A real multi-OBR
 *   ORM (ordering several tests in one message) is a real, deliberately
 *   deferred follow-up -- `message.get("OBR")` would need per-repetition
 *   iteration this mapper does not attempt.
 * - `PID.3.1` (the CX composite's ID Number component) is taken as the MRN
 *   verbatim -- matches this repo's own plain-string MRN convention
 *   (`generateMrn()`, TASK-039), not a full CX-with-assigning-authority
 *   resolution.
 * - `OBR.4.1` (the CE composite's identifier component) is taken as the
 *   test code verbatim -- matched against `testDefinition.code` on the
 *   `apps/api` side (`InteropOrderCorrelationService`).
 * - **Priority is not mapped from ORC.7/TQ1 in v1** -- real HL7
 *   priority/timing encoding is a composite field with per-site variance
 *   this ACL has no confirmed profile to validate against yet. Every
 *   inbound order defaults to `apps/api`'s own `routine` default rather
 *   than guessing at an unverified mapping. A real design-partner profile
 *   is required before this is filled in, not assumed.
 */
export function mapOrmToOrderIngest(
  message: Message,
  rawMessage: string,
): InteropOrderIngestInput {
  const mrn = message.get('PID.3.1').toString().trim();
  if (mrn.length === 0) {
    throw new OrmMappingError('PID.3 (patient MRN) is missing or empty');
  }

  const testCode = message.get('OBR.4.1').toString().trim();
  if (testCode.length === 0) {
    throw new OrmMappingError(
      'OBR.4 (universal service identifier) is missing or empty',
    );
  }

  return { mrn, testCode, rawMessage };
}
