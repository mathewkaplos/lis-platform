import { UnprocessableEntityException } from '@nestjs/common';
import type { UnmatchedReason } from './analyzer-correlation.service';

/**
 * KB-29: "unmatched results park in a pending-match queue rather than
 * being dropped" -- 422, never a plain generic error. `reason` is copied
 * into the problem+json body by `ProblemDetailsFilter` (same pattern as
 * `PanelHoldException`'s own `reason` field) since a bare `HttpException`'s
 * custom response payload is otherwise discarded in favor of the RFC 9457
 * shape (ADR-0013 §2).
 */
export class UnmatchedResultException extends UnprocessableEntityException {
  constructor(public readonly reason: UnmatchedReason) {
    super(`Raw result could not be matched: ${reason}`);
  }
}
