import { SetMetadata } from '@nestjs/common';
import type { Capability } from './capabilities';

export const CAPABILITY_KEY = 'capability';

/**
 * Marks a route as requiring the given capability. Read by CapabilityGuard,
 * which must also be applied — this decorator alone enforces nothing.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);
