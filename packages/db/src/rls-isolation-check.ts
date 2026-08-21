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
 * Wired into CI (`pr.yml`'s `build-and-test` job, `pnpm --filter @lis/db
 * rls-check`, placed after every e2e suite) as of the coverage pass that
 * added the missing `case_narrative` fixture below -- the original "not
 * wired in yet, CI has no DATABASE_URL/migration step" caveat here is
 * stale as of TASK-026, which built that out. Can still be run manually
 * against a local Postgres too (`pnpm --filter @lis/db rls-check`, after
 * `bash scripts/db-reset.sh` -- this script's own fixtures are insert-only,
 * so it must run against a freshly reset DB, never a second time in a row
 * against the same one).
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
import { referringFacility } from "./schema/referring-facility";
import { controlLot } from "./schema/control-lot";
import { criticalNotification } from "./schema/critical-notification";
import { qcRuleViolation } from "./schema/qc-rule-violation";
import { careRelationship } from "./schema/care-relationship";
import { patientPortalAccount } from "./schema/patient-portal-account";
import { resultReleasePolicy } from "./schema/result-release-policy";
import { report } from "./schema/report";
import { cultureRead } from "./schema/culture-read";
import { instrumentAnalyteMapping } from "./schema/instrument-mapping";
import { invoice, invoiceLineItem, payment } from "./schema/billing";
import { observationIdempotencyKey } from "./schema/observation-idempotency";
import { outboxEvent } from "./schema/outbox-event";
import { slaBreach } from "./schema/sla-breach";
import { workflowDefinition, workflowRuleFiring } from "./schema/workflow-definition";
import { caseTable, block, slide, blockFulfillment, caseNarrative, caseReportVersion } from "./schema/anatomic-pathology";
import { wholeSlideImage } from "./schema/whole-slide-image";
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

  // FEAT-066 (ADR-0053): referring_facility fixture, same reasoning as
  // care_relationship's own below -- a genuinely new tenant table this
  // feature introduces.
  await db.insert(referringFacility).values({
    tenantId: TENANT_A,
    name: "RLS Check Referring Facility",
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
  // Issue found live in CI (not reproducible against a fresh local
  // `db-reset.sh`, since no e2e spec has run yet there): `result_release_policy`
  // is unique on `tenant_id` alone (one org-wide policy row per tenant), and
  // some real e2e spec (portal/FEAT-039-related) already creates TENANT_A's
  // row before this check runs in CI's own sequence (placed after every e2e
  // suite, §4 of this task's own proposal doc). `onConflictDoNothing` here,
  // not a plain insert -- the leak check below only needs *a* TENANT_A row to
  // exist to prove isolation against, not specifically one this script itself
  // created.
  await db
    .insert(resultReleasePolicy)
    .values({
      tenantId: TENANT_A,
      mode: "immediate",
      delayHours: 0,
    })
    .onConflictDoNothing({ target: resultReleasePolicy.tenantId });

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

  // #430: report fixture, same reasoning as control_lot's own above -- the
  // live leak check below has no data to prove isolation against on this
  // table without it. contentHash/includedObservations are provenance data
  // only (no format enforced by a check constraint), so placeholder values
  // are sufficient here.
  await db.insert(report).values({
    tenantId: TENANT_A,
    orderedTestId: ot.id,
    contentHash: "rls-check-fixture",
    includedObservations: [],
    generatedByUserId: "99999999-9999-9999-9999-999999999999",
  });

  // #534: 10 more tables added by later features without a matching
  // fixture here, same gap #430/report above already had. Deliberately
  // reuses the existing `ot`/`analyte`/`unit`/`pat`/`obs` fixtures above
  // rather than manufacturing a semantically distinct ordered_test per
  // table -- this function's own established style everywhere else:
  // "valid FK, proves isolation" over domain realism.

  // FEAT-052 (ADR-0046): culture_read fixture. Leaves completedAt/result
  // both null (an open, scheduled read) -- ck_culture_read_completion
  // requires both null or both set together.
  await db.insert(cultureRead).values({
    tenantId: TENANT_A,
    orderedTestId: ot.id,
    scheduledAt: sql`now()`,
  });

  // FEAT-027 (KB-29): instrument_analyte_mapping fixture.
  await db.insert(instrumentAnalyteMapping).values({
    tenantId: TENANT_A,
    instrumentId: "RLS-CHECK-INSTRUMENT",
    channelCode: "RLS-CHECK-CHANNEL",
    analyteId: analyte.id,
    unitId: unit.id,
  });

  // FEAT-046 (ADR-0041): invoice/invoice_line_item/payment fixture chain.
  const [inv] = await db
    .insert(invoice)
    .values({ tenantId: TENANT_A, orderId: ord.id, patientId: pat.id, totalCents: 1000 })
    .returning();
  await db.insert(invoiceLineItem).values({
    tenantId: TENANT_A,
    invoiceId: inv.id,
    testDefinitionId: testDef.id,
    unitPriceCents: 1000,
    amountCents: 1000,
  });
  await db.insert(payment).values({
    tenantId: TENANT_A,
    invoiceId: inv.id,
    method: "cash",
    amountCents: 1000,
    status: "pending",
  });

  // FEAT-027 (ADR-0026): observation_idempotency_key fixture. observationId
  // is a plain uuid (no FK, see this table's own header comment) -- reuses
  // `obs` above for a realistic value anyway.
  await db.insert(observationIdempotencyKey).values({
    tenantId: TENANT_A,
    sourceIdempotencyKey: `RLS-CHECK-${Date.now()}`,
    observationId: obs.id,
  });

  // FEAT-028 (ADR-0028): outbox_event fixture.
  await db.insert(outboxEvent).values({
    tenantId: TENANT_A,
    eventType: "RlsCheckFixture",
    payload: {},
  });

  // FEAT-029 (remainder): sla_breach fixture.
  await db.insert(slaBreach).values({
    tenantId: TENANT_A,
    orderedTestId: ot.id,
    priority: "routine",
    targetMinutes: 60,
    breachedAt: sql`now()`,
  });

  // FEAT-029 (ADR-0029): workflow_definition + workflow_rule_firing fixture
  // chain. workflowDefinitionId on the firing row is a plain uuid (no FK,
  // see that table's own header comment) -- reuses the definition just
  // inserted anyway.
  const [wfDef] = await db
    .insert(workflowDefinition)
    .values({ tenantId: TENANT_A, rules: [] })
    .returning();
  await db.insert(workflowRuleFiring).values({
    tenantId: TENANT_A,
    workflowDefinitionId: wfDef.id,
    ruleId: "rls-check-rule",
    eventType: "RlsCheckFixture",
    matched: false,
  });

  // FEAT-057 (ADR-0049): case/block/slide/block_fulfillment fixture chain --
  // four genuinely new tenant tables this feature introduces, same reasoning
  // as control_lot's own above. Reuses `pat` for a second order (`ord` above
  // already belongs to a chemistry ordered_test/specimen chain -- a case is
  // 1:1 with its own order, ux_case_tenant_order) and `testDef` for the
  // block's own ordered_test.
  const [apOrder] = await db.insert(order).values({ tenantId: TENANT_A, patientId: pat.id }).returning();
  const [caseRow] = await db
    .insert(caseTable)
    .values({ tenantId: TENANT_A, orderId: apOrder.id, accessionNumber: `RLS-CHECK-CASE-${Date.now()}` })
    .returning();
  const [apSpecimen] = await db
    .insert(specimen)
    .values({
      tenantId: TENANT_A,
      caseId: caseRow.id,
      accessionNumber: `${caseRow.accessionNumber}-P1`,
      specimenType: "tissue",
    })
    .returning();
  const [blockRow] = await db
    .insert(block)
    .values({ tenantId: TENANT_A, specimenId: apSpecimen.id, blockNumber: 1, code: `${caseRow.accessionNumber}-B1` })
    .returning();
  const [slideRow] = await db
    .insert(slide)
    .values({
      tenantId: TENANT_A,
      blockId: blockRow.id,
      slideNumber: 1,
      code: `${blockRow.code}-S1`,
    })
    .returning();

  // FEAT-067 (ADR-0055): whole_slide_image fixture -- a genuinely new
  // tenant table this feature introduces.
  await db.insert(wholeSlideImage).values({
    tenantId: TENANT_A,
    slideId: slideRow.id,
    tileObjectPrefix: `${TENANT_A}/wsi/rls-check/`,
    uploadedByUserId: "99999999-9999-9999-9999-999999999999",
  });
  const [apOrderedTest] = await db
    .insert(orderedTest)
    .values({ tenantId: TENANT_A, orderId: apOrder.id, testDefinitionId: testDef.id })
    .returning();
  await db.insert(blockFulfillment).values({ tenantId: TENANT_A, blockId: blockRow.id, orderedTestId: apOrderedTest.id });

  // FEAT-057 (ADR-0049): case_narrative fixture — a genuinely new tenant
  // table this feature introduces, missed in this check's original fixture
  // chain above (found live: the structural sweep and every other table's
  // leak check passed, but this one table had zero TENANT_A rows to prove
  // isolation against at all -- a gap in this script's own coverage, not a
  // real RLS/security issue).
  await db.insert(caseNarrative).values({
    tenantId: TENANT_A,
    caseId: caseRow.id,
    grossDescription: "RLS check fixture -- gross description",
    microscopicDescription: "RLS check fixture -- microscopic description",
    diagnosis: "RLS check fixture -- diagnosis",
    updatedByUserId: "99999999-9999-9999-9999-999999999999",
  });

  // FEAT-059 (ADR-0051): case_report_version fixture — a genuinely new
  // tenant table this feature introduces. Direct insert (not the real
  // sign-out route/signing module) is sufficient here: this check only
  // proves RLS isolation, not the signing flow itself (covered by
  // case-sign-out.e2e-spec.ts).
  await db.insert(caseReportVersion).values({
    tenantId: TENANT_A,
    caseId: caseRow.id,
    versionNumber: 1,
    contentHash: "rls-check-fixture-hash",
    includedContent: {},
    signature: Buffer.from("rls-check-fixture-signature"),
    signedByUserId: "99999999-9999-9999-9999-999999999999",
    signedByRole: "pathologist",
    authTimeUsed: new Date(),
  });

  // FEAT-061 (ADR-0052): image_attachment/image_annotation fixture — two
  // genuinely new tenant tables. observation_created_at is supplied via a
  // server-side subquery, never `obs.createdAt` (a JS-parsed Date, which
  // truncates Postgres's real microsecond timestamptz to milliseconds —
  // database-design Skill entry #10's own documented precision-mismatch
  // trap for any composite FK into observation(id, created_at)).
  const [imageAttachmentRow] = await db
    .insert(schema.imageAttachment)
    .values({
      tenantId: TENANT_A,
      resourceType: "block",
      resourceId: blockRow.id,
      category: "microscopic",
      objectKey: "rls-check-fixture/does-not-need-to-exist-in-object-storage.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      uploadedByUserId: "99999999-9999-9999-9999-999999999999",
    })
    .returning();
  await db.insert(schema.imageAnnotation).values({
    tenantId: TENANT_A,
    imageAttachmentId: imageAttachmentRow.id,
    coordinates: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    observationId: obs.id,
    observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${obs.id})`,
    annotatedByUserId: "99999999-9999-9999-9999-999999999999",
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
  // Real bug found live in CI, not locally (a low-load single-user local
  // run happens to keep reusing the same idle pooled connection; CI's own
  // load pattern doesn't): `setTenant()` uses session-level `set_config`
  // (`is_local: false`, deliberately -- see its own comment), which sticks
  // to whichever physical connection ran it. Without `{ max: 1 }`, `pg.Pool`
  // defaults to up to 10 connections, so the TENANT_A fixture-insert phase
  // and the TENANT_B leak-check phase can land on different physical
  // connections -- a query that never had `set_config` called on ITS OWN
  // connection at all falls back to Postgres's session default, and
  // whatever tenant context happened to be set on that specific connection
  // by an earlier, unrelated query on the same pool leaks through, looking
  // exactly like a real RLS leak. `tenant-catalog-seed-check.ts` (a sibling
  // script with the identical single-shot-but-multi-tenant shape) already
  // pins `{ max: 1 }` for exactly this reason -- this script just never
  // matched that precedent until now.
  const db = createDb(APP_DATABASE_URL, { max: 1 });

  console.log("TASK-024: cross-table RLS isolation check (connected as lis_app)\n");

  console.log("--- Structural sweep: every tenant_id table must have RLS enabled + a policy ---");
  const { tables, failures: structuralFailures } = await structuralSweep(db);
  console.log(`Found ${tables.length} tenant-scoped tables: ${tables.join(", ")}`);
  structuralFailures.forEach((f) => console.log(`FAIL: ${f}`));
  if (structuralFailures.length === 0) console.log("PASS: every tenant table has RLS enabled and a policy.\n");

  console.log("--- Fixture setup under TENANT_A ---");
  await insertFixtures(db);
  console.log(
    "Fixtures inserted for patient/patient_alert/referring_facility/order/ordered_test/specimen/specimen_fulfillment/observation/" +
      "result_history/report/culture_read/instrument_analyte_mapping/invoice/invoice_line_item/payment/" +
      "observation_idempotency_key/outbox_event/sla_breach/workflow_definition/workflow_rule_firing/" +
      "case/block/slide/block_fulfillment/case_narrative/case_report_version/image_attachment/image_annotation/whole_slide_image.\n",
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
