import { createDb } from '@lis/db';

/**
 * TASK-066 (FEAT-021, ADR-0017). A second, deliberately separate connection
 * from this same directory's `db.ts` (`lis_app`) -- connects as
 * `lis_scheduler` via `SCHEDULER_DATABASE_URL`, used ONLY for a job's
 * cross-tenant enumeration phase (a `SELECT tenant_id` restricted by each
 * table's own `scheduler_enumeration` RLS policy and a column-scoped
 * GRANT). The actual mutating work never uses this connection -- it goes
 * through `db` (`lis_app`), per-tenant, exactly like every other write in
 * this repo.
 *
 * Originally lived under `critical-notification/` (its first caller,
 * `CriticalNotificationEscalationService`); relocated here (FEAT-028,
 * ADR-0028) once `OutboxRelayService` became a second, unrelated caller
 * needing the exact same connection -- a shared cross-feature concern, not
 * a critical-notification-specific one, same "second real usage reveals
 * the shared concern" precedent `get-keycloak-token.ts` already set.
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
