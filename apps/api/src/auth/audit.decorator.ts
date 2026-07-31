import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  resourceType: string;
}

/**
 * Marks a route as requiring an audit_event row on every call. Read by
 * AuditInterceptor, which must also be applied (after TenantContextInterceptor)
 * — this decorator alone writes nothing.
 */
export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_KEY, metadata);
