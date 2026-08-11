/**
 * FEAT-049: real-Postgres check for `seedStarterCatalog`, same `tsx`-script
 * convention as `rls-isolation-check.ts`/`golden-dataset-check.ts`/
 * `tenant-isolation-check.ts` (`engineering/testing` entry #1) — this
 * package has no vitest setup, and a mocked DB can't prove this function
 * actually composes real SQL files correctly.
 *
 * Connects as `lis_app` (APP_DATABASE_URL) for the assertions, same
 * BYPASSRLS lesson every other check script in this package documents —
 * `seedStarterCatalog` itself internally uses the raw pool passed to it
 * (here, `lis_app`'s own pool, exactly as `onboarding.service.ts` does in
 * production).
 */
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { seedStarterCatalog } from "./tenant-catalog-seed";

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set (must connect as lis_app, not postgres)");
}

async function main() {
  const db = createDb(APP_DATABASE_URL, { max: 1 });
  const failures: string[] = [];

  console.log("FEAT-049: tenant-catalog-seed check (connected as lis_app)\n");

  const newTenant = crypto.randomUUID();
  await seedStarterCatalog(db.$client, newTenant);

  await db.execute(sql`SELECT set_config('app.tenant_id', ${newTenant}, false)`);
  const testDefs = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM test_definition WHERE tenant_id = ${newTenant}`,
  );
  const testDefCount = Number(testDefs.rows[0]?.count ?? 0);
  if (testDefCount === 0) {
    failures.push("new tenant has 0 test_definition rows after seeding — expected a non-empty starter catalog");
  } else {
    console.log(`PASS: new tenant seeded with ${testDefCount} test_definition rows.`);
  }

  const referenceRanges = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM reference_range WHERE tenant_id = ${newTenant}`,
  );
  const rangeCount = Number(referenceRanges.rows[0]?.count ?? 0);
  if (rangeCount === 0) {
    failures.push("new tenant has 0 reference_range rows after seeding");
  } else {
    console.log(`PASS: new tenant seeded with ${rangeCount} reference_range rows.`);
  }

  // Global tables (ADR-0004) must be untouched by a second tenant's seed —
  // their own ON CONFLICT DO NOTHING should make this idempotent, proven
  // here rather than assumed.
  const before = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM analyte`);
  await seedStarterCatalog(db.$client, crypto.randomUUID());
  const after = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM analyte`);
  if (before.rows[0]?.count !== after.rows[0]?.count) {
    failures.push(
      `global analyte row count changed across two tenants' seeds (${before.rows[0]?.count} -> ${after.rows[0]?.count}) — expected no change`,
    );
  } else {
    console.log(`PASS: global analyte row count unchanged (${after.rows[0]?.count}) across a second tenant's seed.\n`);
  }

  if (failures.length > 0) {
    failures.forEach((f) => console.error(`FAIL: ${f}`));
    console.error(`\n${failures.length} failure(s). See above.`);
    process.exit(1);
  }
  console.log("All tenant-catalog-seed checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
