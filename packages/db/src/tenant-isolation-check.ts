/**
 * FEAT-045 (ADR-0039): cross-schema tenant-tier isolation check.
 *
 * `rls-isolation-check.ts` proves tenant isolation *within* the `shared`
 * tier (RLS rows on shared tables). This script proves the tier-2 mechanism
 * FEAT-045 adds: a `dedicated_schema` tenant's data lives in a genuinely
 * separate schema, not just a separate set of RLS-filtered rows, and two
 * dedicated-schema tenants cannot see each other's schemas.
 *
 * This script provisions its own two throwaway schemas, each with a single
 * representative tenant-scoped table (`patient`, cloned minimally — same
 * tenant_id + RLS + policy shape as `public.patient`) — a real general
 * schema-provisioning tool is explicitly out of scope for FEAT-045 (see its
 * proposal §5) and is FEAT-049's own future job. Proving the resolver +
 * interceptor mechanism does not require that tool to exist yet.
 *
 * Connects as `lis_app` (APP_DATABASE_URL), never `postgres` — same
 * BYPASSRLS lesson `rls-isolation-check.ts` already documents
 * (`rls-multi-tenancy` entry #1).
 */
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { tenant } from "./schema/tenant";
import { resolveTenantRouting } from "./tenant-resolver";

type Db = ReturnType<typeof createDb>;

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set (must connect as lis_app, not postgres)");
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (needed once, only to provision the throwaway schemas)");
}

const SHARED_TENANT = "00000000-0000-0000-0000-000000000001"; // chemistry-catalog seed's fixed tenant
const DEDICATED_TENANT_1 = "00000000-0000-0000-0000-0000000000d1";
const DEDICATED_TENANT_2 = "00000000-0000-0000-0000-0000000000d2";
const SCHEMA_1 = "tenant_tier_check_1";
const SCHEMA_2 = "tenant_tier_check_2";

// Session-scoped set_config (`is_local: false`), same carve-out ADR-0010
// grants rls-isolation-check.ts/golden-dataset-check.ts: this is a
// single-shot, single-connection, single-tenant-at-a-time script, not a
// pooled multi-tenant server -- the production interceptor uses
// transaction-scoped binding (`true`), this script does not need to.
async function bindSession(db: Db, tenantId: string, searchPath: string) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
  await db.execute(sql`SELECT set_config('search_path', ${searchPath}, false)`);
}

// Runs as the `postgres` migrations role (DATABASE_URL), never `lis_app` --
// `lis_app` is deliberately NOCREATEDB and has no CREATE privilege on the
// database itself (confirmed live: an earlier version of this script tried
// `CREATE SCHEMA` as lis_app and got a real `permission denied for database`
// error), the same way a real dedicated-schema tenant's provisioning would
// have to run as a privileged role, not the application role. This is a
// concrete requirement for FEAT-049's future provisioning tool: creating a
// dedicated schema is not just `CREATE SCHEMA` -- it also needs an explicit
// `GRANT USAGE`/table-level grant to `lis_app`, since `ALTER DEFAULT
// PRIVILEGES` (migration 0002_app_role.sql) only covers the `public` schema.
async function provisionDedicatedSchema(migrationDb: Db, schemaName: string) {
  await migrationDb.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
  await migrationDb.execute(sql.raw(`GRANT USAGE ON SCHEMA "${schemaName}" TO "lis_app"`));
  await migrationDb.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."patient" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        mrn text NOT NULL,
        first_name text NOT NULL,
        last_name text NOT NULL,
        sex text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `),
  );
  await migrationDb.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schemaName}"."patient" TO "lis_app"`),
  );
  await migrationDb.execute(sql.raw(`ALTER TABLE "${schemaName}"."patient" ENABLE ROW LEVEL SECURITY`));
  await migrationDb.execute(
    sql.raw(`
      DO $$ BEGIN
        CREATE POLICY tenant_isolation ON "${schemaName}"."patient"
          USING (tenant_id = current_setting('app.tenant_id')::uuid);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `),
  );
}

async function structuralCheck(db: Db): Promise<string[]> {
  const failures: string[] = [];
  const rows = await db
    .select({ id: tenant.id, schemaName: tenant.schemaName })
    .from(tenant)
    .where(sql`${tenant.isolationTier} = 'dedicated_schema'`);

  for (const row of rows) {
    if (!row.schemaName) {
      failures.push(`tenant ${row.id}: dedicated_schema with no schema_name`);
      continue;
    }
    const exists = await db.execute<{ exists: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${row.schemaName}) AS exists`,
    );
    if (!exists.rows[0]?.exists) {
      failures.push(`tenant ${row.id}: schema "${row.schemaName}" does not exist`);
    }
  }
  return failures;
}

async function main() {
  const db = createDb(APP_DATABASE_URL);
  const migrationDb = createDb(DATABASE_URL);

  console.log("FEAT-045: cross-schema tenant-tier isolation check (connected as lis_app)\n");

  console.log("--- Provisioning two throwaway dedicated schemas (as the migrations role) ---");
  await provisionDedicatedSchema(migrationDb, SCHEMA_1);
  await provisionDedicatedSchema(migrationDb, SCHEMA_2);
  await db.insert(tenant).values([
    { id: DEDICATED_TENANT_1, name: "tier-check-1", isolationTier: "dedicated_schema", schemaName: SCHEMA_1 },
    { id: DEDICATED_TENANT_2, name: "tier-check-2", isolationTier: "dedicated_schema", schemaName: SCHEMA_2 },
  ]).onConflictDoNothing();
  console.log(`Provisioned ${SCHEMA_1} and ${SCHEMA_2}, registered both tenants.\n`);

  console.log("--- Structural check: every dedicated_schema tenant's schema actually exists ---");
  const structuralFailures = await structuralCheck(db);
  structuralFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (structuralFailures.length === 0) console.log("PASS: every registered dedicated schema exists.\n");

  console.log("--- Resolver check: routing matches the registered tier ---");
  const routing1 = await resolveTenantRouting(db, DEDICATED_TENANT_1);
  const resolverFailures: string[] = [];
  if (routing1.tier !== "dedicated_schema" || routing1.schemaName !== SCHEMA_1) {
    resolverFailures.push(`resolveTenantRouting(${DEDICATED_TENANT_1}) returned ${JSON.stringify(routing1)}, expected dedicated_schema/${SCHEMA_1}`);
  }
  const routingUnregistered = await resolveTenantRouting(db, SHARED_TENANT);
  if (routingUnregistered.tier !== "shared") {
    resolverFailures.push(`resolveTenantRouting(${SHARED_TENANT}) (no tenant row) returned ${JSON.stringify(routingUnregistered)}, expected shared`);
  }
  resolverFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (resolverFailures.length === 0) console.log("PASS: resolver returns the registered tier, and defaults an unregistered tenant to shared.\n");

  console.log("--- Live within-schema RLS check: tenant_isolation still functions inside a dedicated schema ---");
  const leakFailures: string[] = [];

  // ROGUE_TENANT: a second tenant_id physically inserted into SCHEMA_1's own
  // patient table, alongside DEDICATED_TENANT_1's own row. This is the
  // meaningful risk to prove against -- two different schemas never sharing
  // rows is guaranteed by Postgres schema semantics alone and needs no RLS
  // at all to be true (an earlier version of this check only proved that
  // tautology). What actually needs proving is that `tenant_isolation`'s
  // USING clause still restricts correctly *inside* one dedicated schema,
  // per ADR-0039's own stated defense-in-depth (a dedicated-schema tenant's
  // tables still carry tenant_id + RLS, not just a bare schema boundary).
  const ROGUE_TENANT = "00000000-0000-0000-0000-0000000000ee";

  // A rogue row is inserted into BOTH dedicated schemas, symmetrically --
  // an earlier version of this check only exercised SCHEMA_1's policy this
  // way, leaving SCHEMA_2's policy completely unverified (confirmed live:
  // a deliberately broken `USING (true)` policy on SCHEMA_2 passed silently
  // until this was fixed to insert a rogue row into SCHEMA_2 too).
  for (const [schemaName, ownTenant, mrn] of [
    [SCHEMA_1, DEDICATED_TENANT_1, "TIER-CHECK-1"],
    [SCHEMA_2, DEDICATED_TENANT_2, "TIER-CHECK-2"],
  ] as const) {
    await bindSession(db, ownTenant, `${schemaName}, public`);
    await db.execute(
      sql`INSERT INTO patient (tenant_id, mrn, first_name, last_name, sex) VALUES (${ownTenant}, ${mrn}, 'Tier', 'Own', 'U')`,
    );
    await bindSession(db, ROGUE_TENANT, `${schemaName}, public`);
    await db.execute(
      sql`INSERT INTO patient (tenant_id, mrn, first_name, last_name, sex) VALUES (${ROGUE_TENANT}, ${`TIER-CHECK-ROGUE-${schemaName}`}, 'Rogue', 'Tenant', 'U')`,
    );
  }

  // Each tenant's own session, routed into its own schema, must see only
  // its own row -- not the rogue tenant's, even though both physically live
  // in the same table. This is the check a USING(true)-style policy bug
  // would fail, tested against both schemas independently.
  for (const [schemaName, ownTenant, mrn] of [
    [SCHEMA_1, DEDICATED_TENANT_1, "TIER-CHECK-1"],
    [SCHEMA_2, DEDICATED_TENANT_2, "TIER-CHECK-2"],
  ] as const) {
    await bindSession(db, ownTenant, `${schemaName}, public`);
    const own = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM patient`);
    if (Number(own.rows[0]?.count ?? 0) !== 1) {
      leakFailures.push(`${ownTenant}'s session in ${schemaName} sees ${own.rows[0]?.count} row(s), expected 1 (its own only)`);
    }
    const seesRogue = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM patient WHERE mrn = ${`TIER-CHECK-ROGUE-${schemaName}`}`,
    );
    if (Number(seesRogue.rows[0]?.count ?? 0) !== 0) {
      leakFailures.push(`${ownTenant}'s session in ${schemaName} sees the rogue tenant's row — RLS LEAK inside a dedicated schema`);
    }
  }

  // Tenant 2's session must see 0 rows from SCHEMA_1 -- the cross-schema
  // half of the proof (two different schemas never sharing rows, which
  // Postgres guarantees structurally, but worth asserting explicitly).
  await bindSession(db, DEDICATED_TENANT_2, `${SCHEMA_2}, public`);
  const crossSchema = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM patient WHERE mrn IN ('TIER-CHECK-1', ${`TIER-CHECK-ROGUE-${SCHEMA_1}`})`,
  );
  if (Number(crossSchema.rows[0]?.count ?? 0) !== 0) {
    leakFailures.push(`tenant 2's session in ${SCHEMA_2} sees ${crossSchema.rows[0]?.count} row(s) from ${SCHEMA_1} — schema routing LEAK`);
  }

  // A shared-tier session (default public search_path, no dedicated schema
  // bound) must see none of the dedicated-schema rows via public.patient.
  await db.execute(sql`SELECT set_config('app.tenant_id', ${SHARED_TENANT}, false)`);
  await db.execute(sql`SELECT set_config('search_path', 'public', false)`);
  const sharedView = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM patient WHERE mrn LIKE 'TIER-CHECK%'`,
  );
  if (Number(sharedView.rows[0]?.count ?? 0) !== 0) {
    leakFailures.push(`shared-tier session sees ${sharedView.rows[0]?.count} dedicated-schema row(s) via public.patient — LEAK`);
  }

  leakFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (leakFailures.length === 0) {
    console.log("PASS: tenant_isolation still isolates correctly inside each dedicated schema, across schemas, and from the shared/public tier.\n");
  }

  const allFailures = [...structuralFailures, ...resolverFailures, ...leakFailures];
  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} failure(s). See above.`);
    process.exit(1);
  }
  console.log("All tenant-tier isolation checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
