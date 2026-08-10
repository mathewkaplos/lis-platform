import { careRelationship } from '@lis/db';
import { eq } from 'drizzle-orm';
import type { RequestWithTx } from './tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

/**
 * FEAT-040 (proposal §10 Q1, resolved): any tenant-wide role present grants
 * full visibility, same as today -- KB-10 frames relationship-scoping as
 * the *portal* access shape for an external clinician, not a restriction on
 * internal staff who also happen to hold a clinical credential.
 * `clinician`-only (no other role) is the only case that gets
 * relationship-scoped. Kept here, not in `capabilities.ts`, because this is
 * a data-scope decision (KB-10's "row-level filtering" layer), not a
 * capability grant -- `search()`/`getById()` have never had a
 * `RequireCapability` gate (proposal §10 Q2, deliberately unchanged).
 */
const TENANT_WIDE_ROLES = ['technologist', 'verifier', 'qa'] as const;

export function isClinicianOnly(roles: readonly string[]): boolean {
  return (
    roles.includes('clinician') &&
    !roles.some((role) =>
      (TENANT_WIDE_ROLES as readonly string[]).includes(role),
    )
  );
}

/**
 * Patient ids a `clinician`-only principal has an established
 * `care_relationship` with (proposal §10 Q3: patient-only, no order/
 * observation shape yet). Tenant isolation is RLS alone, matching every
 * other read route in this file -- no explicit `tenantId` filter added in
 * application code.
 */
export async function relatedPatientIds(
  tx: Tx,
  clinicianUserId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ patientId: careRelationship.patientId })
    .from(careRelationship)
    .where(eq(careRelationship.clinicianUserId, clinicianUserId));
  return rows.map((row) => row.patientId);
}
