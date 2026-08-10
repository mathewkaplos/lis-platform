import { patientPortalAccount } from '@lis/db';
import { eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

/**
 * FEAT-039 (`engineering/authz` entry #1's own data-scope-vs-capability
 * distinction, extended): resolves the real `patient.id` a `patient`-role
 * principal's `sub` is linked to, via `patient_portal_account` (1:1,
 * proposal §5). Tenant isolation is RLS alone -- no explicit `tenantId`
 * filter added in application code, matching every other read route in
 * this repo.
 *
 * Returns `null` when the principal has no linked account yet (a real,
 * valid state -- not every `patient`-role token is necessarily enrolled) --
 * the caller must treat this as "no results," never fall back to "show
 * everything."
 */
export async function resolveOwnPatientId(
  tx: Tx,
  patientUserId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ patientId: patientPortalAccount.patientId })
    .from(patientPortalAccount)
    .where(eq(patientPortalAccount.patientUserId, patientUserId))
    .limit(1);
  return row?.patientId ?? null;
}
