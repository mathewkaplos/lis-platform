import { createDb } from '@lis/db';

/**
 * apps/api connects as lis_app via APP_DATABASE_URL — never DATABASE_URL
 * (which may be the postgres superuser, BYPASSRLS, in some environments).
 * Same rule the engineering/testing Skill already established for
 * rls-isolation-check.ts/golden-dataset-check.ts, applied here to the
 * running server, not just one-off scripts.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

// DB_POOL_MAX exists for TASK-030/ADR-0010's pooling-leak test, which
// deliberately forces a small pool (e.g. 1) to prove SET LOCAL-based tenant
// binding survives physical-connection reuse — not a production tuning
// knob, though a sane default is still needed for real use.
export const db = createDb(requiredEnv('APP_DATABASE_URL'), {
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined,
});
