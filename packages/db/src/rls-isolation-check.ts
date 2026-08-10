/**
 * TASK-024 (FEAT-006): cross-table RLS isolation check.
 *
 * Per the approved FEAT-006 proposal §5/§10 Q4, this task produces no new
 * RLS-policy SQL — Constitution Law #4 already forces every tenant table to
 * carry tenant_id + RLS from the migration that creates it (TASK-023's own
 * migration, in this repo's case). What TASK-024 actually delivers is the
 * proof: a real, repeatable check that (a) structurally audits every table
 * in the schema for the RLS-enabled + policy-present pair, so a future table
 * that forgets one can't slip through unnoticed, and (b) exercises real
 * cross-tenant data access and confirms the wrong tenant sees nothing.
 *
 * Deliberately NOT wired into CI here. CI (`pr.yml`) provisions a real
 * Postgres service but has no DATABASE_URL/migration step at all yet —
 * building that out is FEAT-007/TASK-026's explicit job ("golden-dataset
 * test runner in CI"), not TASK-024's. This runs against a real Postgres
 * instance manually (`pnpm --filter @lis/db rls-check`, after `pnpm
 * db:reset`) until that CI harness exists, at which point it's a natural
 * fit to wire in as-is.
 *
 * Connects as `lis_app` (APP_DATABASE_URL), never `postgres` — the
 * BYPASSRLS/superuser lesson from TASK-017 applies here more than anywhere:
 * this script's entire purpose is proving RLS actually restricts, which a
 * superuser connection would silently no-op.
 */
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import * as schema from "./schema";
import { order, orderedTest } from "./schema/order";
import { specimen, specimenFulfillment } from "./schema/specimen";
import { observation } from "./schema/observation";
import { patient } from "./schema/patient";
import { patientAlert } from "./schema/patient-alert";
import { controlLot } from "./schema/control-lot";
import { criticalNotification } from "./schema/critical-notification";
import { qcRuleViolation } from "./schema/qc-rule-violation";
import { careRelationship } from "./schema/care-relationship";
import { patientPortalAccount } from "./schema/patient-portal-account";
import { resultReleasePolicy } from "./schema/result-release-policy";
import { writeAuditEvent } from "./audit";

type Db = ReturnType<typeof createDb>;

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set (must connect as lis_app, not postgres)");
}

// TENANT_A is the chemistry-catalog seed's fixed tenant (db/seed/chemistry-catalog.sql)
// — reused here rather than duplicated, since it already has real rows in
// analyte/unit/code_system_value/panel/panel_test/test_analyte/test_definition/
// reference_range. TENANT_B is deliberately never written to by anything —
// its entire purpose is to prove it sees zero rows of TENANT_A's data.
const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";

async function setTenant(db: Db, tenantId: string) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
}

async function structuralSweep(db: Db): Promise<{ tables: string[]; failures: string[] }> {
  // Every ordinary or partitioned-parent table in `public` that carries a
  // tenant_id column (relispartition excludes observation's physical yearly
  // partitions — RLS on the parent already covers them transparently, per
  // TASK-022's own verification; testing the parent is sufficient and avoids
  // 6 redundant per-partition entries).
  const tables = await db.execute<{ relname: string }>(sql`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT c.relispartition
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
      )
    ORDER BY c.relname;
  `);

  const failures: string[] = [];
  const tableNames = tables.rows.map((r) => r.relname);

  for (const table of tableNames) {
    const rls = await db.execute<{ relrowsecurity: boolean }>(
      sql`SELECT relrowsecurity FROM pg_class WHERE relname = ${table} AND relnamespace = 'public'::regnamespace`,
    );
    const policyCount = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}`,
    );
    if (!rls.rows[0]?.relrowsecurity) {
      failures.push(`${table}: has tenant_id but ROW LEVEL SECURITY is not enabled (Constitution Law #4)`);
    }
    if (Number(policyCount.rows[0]?.count ?? 0) === 0) {
      failures.push(`${table}: has tenant_id but no RLS policy exists (Constitution Law #4)`);
    }
  }

  return { tables: tableNames, failures };
}

// Inserts one fixture row per table the chemistry-catalog seed doesn't
// already cover, under TENANT_A, so the live leak check below has real data
// to prove isolation against on every tenant table, not just the ones the
// seed happens to populate.
async function insertFixtures(db: Db) {
  await setTenant(db, TENANT_A);

  const [testDef] = await db.select().from(schema.testDefinition).where(sql`tenant_id = ${TENANT_A}`).limit(1);
  const [analyte] = await db.select().from(schema.analyte).limit(1); // global, per ADR-0004
  const [unit] = await db.select().from(schema.unit).limit(1); // global, per ADR-0004
  if (!testDef || !analyte || !unit) {
    throw new Error("chemistry-catalog seed data not found — run `pnpm db:reset` first");
  }

  // TASK-063 (FEAT-018, ADR-0015): control_lot fixture, so the live leak
  // check below has real data to prove isolation against — mirrors every
  // other fixture in this function, not exercised by any other e2e spec's
  // own tenant-A/tenant-B pair.
  const [lot] = await db
    .insert(controlLot)
    .values({
      tenantId: TENANT_A,
      analyteId: analyte.id,
      level: "normal",
      unitId: unit.id,
      targetMean: "5.0",
      targetSd: "0.2",
      lotNumber: `RLS-CHECK-${Date.now()}`,
    })
    .returning();

  // TASK-067 (FEAT-019, ADR-0018): qc_rule_violation fixture, same reasoning
  // as control_lot's own above -- a genuinely new tenant table this task
  // introduces. Needs a real QC observation (isControl = true) to satisfy
  // the composite FK; observationCreatedAt is a server-side subquery, same
  // precision-mismatch fix as critical_notification's own fixture below.
  const [qcObs] = await db
    .insert(observation)
    .values({
      tenantId: TENANT_A,
      isControl: true,
      controlLotId: lot.id,
      analyteId: analyte.id,
      dataType: "quantity",
      valueNum: "9.5",
      source: "manual",
    })
    .returning();
  await db.insert(qcRuleViolation).values({
    tenantId: TENANT_A,
    controlLotId: lot.id,
    observationId: qcObs.id,
    observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${qcObs.id})`,
    ruleCode: "1_3s",
    severity: "rejection",
  });

  // TASK-038: patient is a real row now, not a sentinel UUID — observation.
  // patient_id and order.patient_id both carry a real FK to patient(id) as
  // of this migration, so a fake id (pre-TASK-038 this file used
  // "99999999-...") is rejected at insert time.
  const [pat] = await db
    .insert(patient)
    .values({ tenantId: TENANT_A, mrn: `RLS-CHECK-${Date.now()}`, firstName: "RLS", lastName: "Check", sex: "U" })
    .returning();
  await db.insert(patientAlert).values({
    tenantId: TENANT_A,
    patientId: pat.id,
    alertType: "medical_alert",
    severity: "low",
    description: "RLS isolation check fixture",
    addedByPrincipalId: "99999999-9999-9999-9999-999999999999",
  });

  // FEAT-040: care_relationship fixture, same reasoning as control_lot's own
  // above -- a genuinely new tenant table this task introduces.
  // clinicianUserId is a raw Keycloak sub string (no user table exists), so
  // any non-empty placeholder proves isolation here.
  await db.insert(careRelationship).values({
    tenantId: TENANT_A,
    clinicianUserId: "99999999-9999-9999-9999-999999999999",
    patientId: pat.id,
  });

  // FEAT-039: patient_portal_account + result_release_policy fixtures, same
  // reasoning as care_relationship's own above -- two genuinely new tenant
  // tables this task introduces.
  await db.insert(patientPortalAccount).values({
    tenantId: TENANT_A,
    patientUserId: "99999999-9999-9999-9999-999999999999",
    patientId: pat.id,
  });
  await db.insert(resultReleasePolicy).values({
    tenantId: TENANT_A,
    mode: "immediate",
    delayHours: 0,
  });

  const [ord] = await db.insert(order).values({ tenantId: TENANT_A, patientId: pat.id }).returning();
  const [ot] = await db
    .insert(orderedTest)
    .values({ tenantId: TENANT_A, orderId: ord.id, testDefinitionId: testDef.id })
    .returning();
  const [sp] = await db
    .insert(specimen)
    .values({ tenantId: TENANT_A, accessionNumber: `RLS-CHECK-${Date.now()}`, specimenType: "blood_edta" })
    .returning();
  await db.insert(specimenFulfillment).values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

  const [obs] = await db
    .insert(observation)
    .values({
      tenantId: TENANT_A,
      orderedTestId: ot.id,
      analyteId: analyte.id,
      specimenId: sp.id,
      patientId: pat.id,
      dataType: "quantity",
      valueNum: "5.0",
      source: "manual",
    })
    .returning();

  // result_history is populated only by fn_observation_supersede (TASK-021),
  // never a direct insert (see result-history.ts's own header comment) — a
  // hand-crafted row here would also hit a real precision mismatch (drizzle
  // round-trips created_at through a JS Date, which truncates Postgres's
  // microsecond timestamptz to milliseconds, breaking the composite FK's
  // exact-equality lookup). Inserting a second, amending observation
  // triggers the real fn_observation_link_created_at + fn_observation_supersede
  // chain, which computes the companion *_created_at columns and the
  // result_history row entirely in SQL, at full precision, exactly as any
  // real correction would in production.
  await db.insert(observation).values({
    tenantId: TENANT_A,
    orderedTestId: ot.id,
    analyteId: analyte.id,
    specimenId: sp.id,
    patientId: pat.id,
    dataType: "quantity",
    valueNum: "5.2",
    source: "manual",
    amendmentOf: obs.id,
  });

  // TASK-065 (FEAT-021, ADR-0016): critical_notification fixture, same
  // reasoning as control_lot's own above -- a genuinely new tenant table
  // this task introduces, so the live leak check needs real data to prove
  // isolation against. observationCreatedAt is a server-side subquery, not
  // `obs.createdAt` -- a real, failed-the-hard-way precision mismatch
  // (drizzle's JS Date round-trip truncates Postgres's microsecond
  // timestamptz to milliseconds, breaking this composite FK's exact-equality
  // lookup), same fix as finalize()'s own creation hook in
  // observation.controller.ts.
  await db.insert(criticalNotification).values({
    tenantId: TENANT_A,
    observationId: obs.id,
    observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${obs.id})`,
  });

  // audit_event fixture, via the real writer (TASK-025) rather than a
  // direct insert — exercises the same hash-chain path any real caller
  // would use, matching the same "trigger the real path" reasoning as the
  // observation/result_history fixture above.
  await writeAuditEvent(db, {
    tenantId: TENANT_A,
    actorPrincipalId: "99999999-9999-9999-9999-999999999999",
    actorRole: "lab_technician",
    actorType: "human",
    action: "specimen.receive",
    resourceType: "specimen",
    resourceId: sp.id,
  });
}

async function liveLeakCheck(db: Db, tables: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const table of tables) {
    await setTenant(db, TENANT_A);
    const a = await db.execute<{ count: string }>(sql.raw(`SELECT count(*)::text AS count FROM "${table}"`));
    await setTenant(db, TENANT_B);
    const b = await db.execute<{ count: string }>(sql.raw(`SELECT count(*)::text AS count FROM "${table}"`));

    const countA = Number(a.rows[0]?.count ?? 0);
    const countB = Number(b.rows[0]?.count ?? 0);

    if (countA === 0) {
      failures.push(`${table}: tenant A has 0 rows — cannot prove isolation without fixture data`);
    }
    if (countB !== 0) {
      failures.push(`${table}: tenant B (wrong tenant) sees ${countB} row(s) — RLS LEAK`);
    }
  }
  return failures;
}

async function main() {
  const db = createDb(APP_DATABASE_URL);

  console.log("TASK-024: cross-table RLS isolation check (connected as lis_app)\n");

  console.log("--- Structural sweep: every tenant_id table must have RLS enabled + a policy ---");
  const { tables, failures: structuralFailures } = await structuralSweep(db);
  console.log(`Found ${tables.length} tenant-scoped tables: ${tables.join(", ")}`);
  structuralFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (structuralFailures.length === 0) console.log("PASS: every tenant table has RLS enabled and a policy.\n");

  console.log("--- Fixture setup under TENANT_A ---");
  await insertFixtures(db);
  console.log(
    "Fixtures inserted for patient/patient_alert/order/ordered_test/specimen/specimen_fulfillment/observation/result_history.\n",
  );

  console.log("--- Live cross-tenant leak check: TENANT_B must see 0 rows of TENANT_A's data ---");
  const leakFailures = await liveLeakCheck(db, tables);
  leakFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (leakFailures.length === 0) console.log("PASS: no cross-tenant leak detected on any of the tables above.\n");

  const allFailures = [...structuralFailures, ...leakFailures];
  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} failure(s). See above.`);
    process.exit(1);
  }
  console.log(`All checks passed across ${tables.length} tenant-scoped tables.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
