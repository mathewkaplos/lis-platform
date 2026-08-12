import { SetMetadata } from '@nestjs/common';

export const STEP_UP_KEY = 'stepUp';

/**
 * Marks a route as requiring a fresh step-up assertion (FEAT-059, ADR-0051).
 * Read by StepUpGuard, which must also be applied — this decorator alone
 * enforces nothing. Mirrors @RequireCapability's own marker-decorator shape.
 */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);
