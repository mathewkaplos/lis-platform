import { UnprocessableEntityException } from '@nestjs/common';
import type { InteropUnmatchedReason } from './interop-order-correlation.service';

/**
 * Same "park, never drop" precedent as `UnmatchedResultException`
 * (`gateway-ingest/`) -- an inbound HL7 order that can't be correlated to a
 * real patient/test is a real, expected failure mode (an unregistered MRN,
 * a test code with no matching catalog entry), not a 500.
 */
export class UnmatchedOrderException extends UnprocessableEntityException {
  constructor(public readonly reason: InteropUnmatchedReason) {
    super(`Inbound order could not be matched: ${reason}`);
  }
}
