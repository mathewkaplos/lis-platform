import { pgTable, pgEnum, uuid, text, numeric, boolean, jsonb, timestamp, index, pgPolicy, check, AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte, unit } from "./catalog";

// Tenant-scoped per ADR-0004: this is operational, tenant-varying clinical
// data, not global reference data like analyte/unit.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-14's ten value-storage kinds. Native ENUM per ADR-0006 (a deliberate,
// one-off deviation from this schema's usual text-discriminator convention,
// scoped to this column only).
export const observationDataType = pgEnum("observation_data_type", [
  "quantity",
  "ordinal",
  "coded",
  "boolean",
  "text",
  "ratio",
  "datetime",
  "table",
  "structured",
  "attachment",
]);

// KB-06's canonical `observation` DDL ("heart of the schema"). ordered_test_id
// / specimen_id / patient_id are required plain uuid columns with no FK per
// ADR-0005 (their natural targets — ordered_test/specimen via TASK-023,
// patient via TASK-038 — are built in later features/milestones by design;
// the FK constraint is backfilled by those migrations, not here).
export const observation = pgTable(
  "observation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),

    orderedTestId: uuid("ordered_test_id").notNull(), // FK backfilled by TASK-023, see ADR-0005
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    specimenId: uuid("specimen_id").notNull(), // FK backfilled by TASK-023, see ADR-0005
    patientId: uuid("patient_id").notNull(), // FK backfilled by TASK-038 (M3), see ADR-0005

    dataType: observationDataType("data_type").notNull(),
    valueNum: numeric("value_num"), // quantity
    valueCode: text("value_code"), // coded/ordinal
    valueBool: boolean("value_bool"), // boolean
    valueText: text("value_text"), // text
    valueDatetime: timestamp("value_datetime", { withTimezone: true }), // datetime
    valueJson: jsonb("value_json"), // table/structured/ratio payloads
    unitId: uuid("unit_id").references(() => unit.id), // canonical unit, traceable (mirrors reference_range.unitId)
    unit: text("unit"), // UCUM display, snapshotted at write time — never recomputed later

    // Snapshot fields — captured once at write time per KB-06/KB-14's
    // "snapshot, never recompute" rule; must keep reading correctly even if
    // the reference_range row resolved from is later superseded.
    refLow: numeric("ref_low"),
    refHigh: numeric("ref_high"),
    refCondition: text("ref_condition"),
    refSource: text("ref_source"),

    flags: text("flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // N,H,L,HH,LL,A,D,R
    interpretation: text("interpretation"),

    status: text("status").notNull().default("registered"), // registered|preliminary|verified|reported|amended|corrected|cancelled|rejected
    methodId: uuid("method_id"), // no FK: no method catalog table exists yet in M1
    source: text("source").notNull(), // manual|analyzer|calculated|imported
    instrumentId: uuid("instrument_id"), // no FK: no instrument table exists yet
    operatorUserId: uuid("operator_user_id"), // no FK: no user table exists yet (M2)
    verifierUserId: uuid("verifier_user_id"), // no FK: no user table exists yet (M2)
    producedAt: timestamp("produced_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    previousObservationId: uuid("previous_observation_id").references((): AnyPgColumn => observation.id), // delta/trend chain
    amendmentOf: uuid("amendment_of").references((): AnyPgColumn => observation.id), // correction lineage, enforced append-only in TASK-021
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_obs_trend").on(table.tenantId, table.patientId, table.analyteId, table.producedAt),
    index("ix_obs_ordered_test").on(table.orderedTestId),
    index("ix_obs_flags").using("gin", table.flags),
    check("ck_observation_quantity_value", sql`(${table.dataType} <> 'quantity') OR (${table.valueNum} IS NOT NULL)`),
    check("ck_observation_ratio_value", sql`(${table.dataType} <> 'ratio') OR (${table.valueNum} IS NOT NULL) OR (${table.valueJson} IS NOT NULL)`),
    check("ck_observation_ordinal_value", sql`(${table.dataType} <> 'ordinal') OR (${table.valueCode} IS NOT NULL)`),
    check("ck_observation_coded_value", sql`(${table.dataType} <> 'coded') OR (${table.valueCode} IS NOT NULL)`),
    check("ck_observation_boolean_value", sql`(${table.dataType} <> 'boolean') OR (${table.valueBool} IS NOT NULL)`),
    check("ck_observation_text_value", sql`(${table.dataType} <> 'text') OR (${table.valueText} IS NOT NULL)`),
    check("ck_observation_datetime_value", sql`(${table.dataType} <> 'datetime') OR (${table.valueDatetime} IS NOT NULL)`),
    check("ck_observation_table_value", sql`(${table.dataType} <> 'table') OR (${table.valueJson} IS NOT NULL)`),
    check("ck_observation_structured_value", sql`(${table.dataType} <> 'structured') OR (${table.valueJson} IS NOT NULL)`),
    check("ck_observation_attachment_value", sql`(${table.dataType} <> 'attachment') OR (${table.valueJson} IS NOT NULL)`),
    tenantIsolation(),
  ],
).enableRLS();
