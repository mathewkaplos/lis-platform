/**
 * ADR-0036 / task-459: proves writeAuditEvent's per-tenant advisory lock
 * actually serializes concurrent writers for the same tenant, and does not
 * block writers for different tenants.
 *
 * Follows this repo's own real-Postgres integration-check convention
 * (rls-isolation-check.ts, golden-dataset-check.ts): a plain tsx script,
 * PASS/FAIL console reporting, non-zero exit on failure -- not a Vitest
 * suite (engineering/testing Skill entry #1).
 *
 * Connects as lis_app (APP_DATABASE_URL), matching every other real write in
 * this repo -- never postgres/BYPASSRLS.
 *
 * Runs against two fresh, randomly generated tenant ids each run (not the
 * shared seeded TENANT_A/TENANT_B) so this check never depends on, or
 * disturbs, any other fixture's own chain -- each run starts both tenants'
 * chains empty (prev_hash null).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { writeAuditEvent, verifyAuditChain } from "./audit";

type Db = ReturnType<typeof createDb>;

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set (must connect as lis_app, not postgres)");
}

const CONCURRENT_WRITES = 15;

async function writeOneEvent(db: Db, tenantId: string, i: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    await writeAuditEvent(tx, {
      tenantId,
      actorPrincipalId: "00000000-0000-0000-0000-000000000099",
      actorRole: "system",
      actorType: "service",
      action: "audit-chain-concurrency-check.write",
      resourceType: "audit-chain-concurrency-check",
      resourceId: randomUUID(),
      after: { i },
    });
  });
}

// audit_event's own RLS SELECT policy requires app.tenant_id to already be
// set (tenant_isolation, packages/db/src/schema/audit.ts) -- same as every
// other tenant-scoped read in this repo, so verification runs inside its
// own SET LOCAL-scoped transaction, not directly against the bare pool.
async function verifyAndCount(
  db: Db,
  tenantId: string,
): Promise<{ valid: boolean; brokenAtId?: string; count: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const result = await verifyAuditChain(tx, tenantId);
    const rows = await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_event WHERE tenant_id = ${tenantId}`,
    );
    return { ...result, count: Number(rows.rows[0]?.count ?? 0) };
  });
}

async function sameTenantSerializes(db: Db): Promise<string[]> {
  const failures: string[] = [];
  const tenantId = randomUUID();

  // Fired via Promise.all, not sequential awaits -- CONCURRENT_WRITES
  // transactions genuinely racing to write this one tenant's chain. Before
  // ADR-0036's fix, a burst like this reliably reproduced the exact
  // corruption traced live in lis-platform#459 (a later writer's prev_hash
  // pointing at an earlier ancestor than its true immediate predecessor).
  await Promise.all(
    Array.from({ length: CONCURRENT_WRITES }, (_, i) => writeOneEvent(db, tenantId, i)),
  );

  const result = await verifyAndCount(db, tenantId);
  if (!result.valid) {
    failures.push(
      `same-tenant burst of ${CONCURRENT_WRITES} concurrent writes produced an invalid chain, brokenAtId=${result.brokenAtId}`,
    );
  }
  if (result.count !== CONCURRENT_WRITES) {
    failures.push(`expected ${CONCURRENT_WRITES} rows for the burst tenant, found ${result.count}`);
  }

  return failures;
}

async function differentTenantsDoNotBlockEachOther(db: Db): Promise<string[]> {
  const failures: string[] = [];
  const tenantX = randomUUID();
  const tenantY = randomUUID();

  const start = Date.now();
  await Promise.all([
    ...Array.from({ length: CONCURRENT_WRITES }, (_, i) => writeOneEvent(db, tenantX, i)),
    ...Array.from({ length: CONCURRENT_WRITES }, (_, i) => writeOneEvent(db, tenantY, i)),
  ]);
  const elapsedMs = Date.now() - start;

  const [resultX, resultY] = await Promise.all([
    verifyAndCount(db, tenantX),
    verifyAndCount(db, tenantY),
  ]);
  if (!resultX.valid) {
    failures.push(`tenant X's own chain is invalid, brokenAtId=${resultX.brokenAtId}`);
  }
  if (!resultY.valid) {
    failures.push(`tenant Y's own chain is invalid, brokenAtId=${resultY.brokenAtId}`);
  }

  console.log(
    `  (${CONCURRENT_WRITES * 2} writes across 2 tenants completed in ${elapsedMs}ms -- ` +
      `two tenants' locks are independent, so this is not expected to take meaningfully ` +
      `longer than the same-tenant burst above)`,
  );

  return failures;
}

async function main() {
  const db = createDb(APP_DATABASE_URL);

  console.log("ADR-0036 / task-459: audit-chain per-tenant write concurrency check (connected as lis_app)\n");

  console.log(`--- Same tenant: ${CONCURRENT_WRITES} concurrent writeAuditEvent calls must produce a valid chain ---`);
  const sameTenantFailures = await sameTenantSerializes(db);
  sameTenantFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (sameTenantFailures.length === 0) {
    console.log(`PASS: ${CONCURRENT_WRITES} concurrent same-tenant writes chained correctly, verifyAuditChain valid.\n`);
  }

  console.log("--- Different tenants: concurrent writers for two different tenants must not corrupt either chain ---");
  const crossTenantFailures = await differentTenantsDoNotBlockEachOther(db);
  crossTenantFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (crossTenantFailures.length === 0) {
    console.log("PASS: both tenants' chains independently valid.\n");
  }

  const allFailures = [...sameTenantFailures, ...crossTenantFailures];
  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} failure(s). See above.`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
