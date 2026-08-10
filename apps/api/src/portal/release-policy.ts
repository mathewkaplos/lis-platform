import { resultReleasePolicy } from '@lis/db';
import { eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

export interface ReleasePolicy {
  mode: 'immediate' | 'delayed';
  delayHours: number;
}

const DEFAULT_POLICY: ReleasePolicy = { mode: 'immediate', delayHours: 0 };

/**
 * FEAT-039 (proposal §10 Q1, resolved): a deliberately minimal per-tenant
 * gate -- `immediate` (visible as soon as `verified`) or `delayed`
 * (visible once `verifiedAt + delayHours` has passed). No admin
 * endpoint changes this yet (proposal §5); a tenant with no row at all
 * defaults to `immediate`, matching the column's own DB-level default
 * rather than requiring every tenant to be explicitly seeded.
 */
export async function getReleasePolicy(
  tx: Tx,
  tenantId: string,
): Promise<ReleasePolicy> {
  const [row] = await tx
    .select({
      mode: resultReleasePolicy.mode,
      delayHours: resultReleasePolicy.delayHours,
    })
    .from(resultReleasePolicy)
    .where(eq(resultReleasePolicy.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return DEFAULT_POLICY;
  }
  return {
    mode: row.mode as ReleasePolicy['mode'],
    delayHours: row.delayHours,
  };
}

/** Whether a result verified at `verifiedAt` is currently visible to the
 * portal under `policy`, evaluated against `now` (passed explicitly so
 * tests can control it deterministically rather than racing real time). */
export function isReleased(
  policy: ReleasePolicy,
  verifiedAt: Date,
  now: Date,
): boolean {
  if (policy.mode === 'immediate') {
    return true;
  }
  const releaseAt = new Date(
    verifiedAt.getTime() + policy.delayHours * 60 * 60 * 1000,
  );
  return now >= releaseAt;
}
