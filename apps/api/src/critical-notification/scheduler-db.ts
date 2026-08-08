import { createDb } from '@lis/db';

/**
 * TASK-066 (FEAT-021, ADR-0017). A second, deliberately separate connection
 * from `apps/api/src/auth/db.ts`'s own `db` (lis_app) -- connects as
 * `lis_scheduler` via `SCHEDULER_DATABASE_URL`, used ONLY for the
 * escalation job's enumeration phase (`SELECT tenant_id FROM
 * critical_notification`, restricted to pending rows by the
 * `scheduler_enumeration` RLS policy and a column-scoped GRANT). The
 * actual escalation `UPDATE`/audit write never uses this connection -- it
 * goes through `db` (lis_app), per-tenant, exactly like every other write
 * in this repo.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export const schedulerDb = createDb(requiredEnv('SCHEDULER_DATABASE_URL'), {
  max: 1, // enumeration-only, low-frequency, no concurrency need
});
