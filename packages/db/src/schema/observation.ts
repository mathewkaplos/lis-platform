import { pgTable, pgEnum, uuid, text, numeric, boolean, jsonb, timestamp, index, pgPolicy, check, primaryKey, foreignKey } from "drizzle-orm/pg-core";
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
//
// PARTITION BY RANGE (created_at) per ADR-0008 — not representable by
// drizzle-kit, so db/migrations/0008_observation_partitioning.sql is
// hand-written and is the source of truth for the partitioning/trigger DDL;
// this file models the columns/constraints drizzle can express (including
// the composite primary key ADR-0008's addendum requires).
export const observation = pgTable(
  "observation",
  {
    id: uuid("id").notNull().defaultRandom(),
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

    previousObservationId: uuid("previous_observation_id"), // delta/trend chain
    // Companion to previousObservationId/amendmentOf, per ADR-0008's
    // addendum: partitioning by created_at forces observation's primary key
    // to become composite (id, created_at) (Postgres requires partition-key
    // columns in any unique/PK constraint), so a single-column FK to
    // observation.id is no longer possible. Auto-populated by the
    // fn_observation_link_created_at BEFORE INSERT trigger (0008 migration)
    // — callers keep setting only previousObservationId/amendmentOf as
    // before, never this column directly.
    previousObservationCreatedAt: timestamp("previous_observation_created_at", { withTimezone: true }),
    amendmentOf: uuid("amendment_of"), // correction lineage (new->old)
    amendmentOfCreatedAt: timestamp("amendment_of_created_at", { withTimezone: true }),
    // (old->new), per ADR-0007: reconciles Constitution Law #2's literal
    // "superseded_by links old to new" with amendment_of's opposite direction.
    // `WHERE superseded_by IS NULL` is the cheap "current observations only"
    // filter; amendment_of stays as the O(1) "what did this correct" lookup.
    // Maintained only by the TASK-021 trigger (fn_observation_supersede /
    // fn_observation_append_only) — never set by a direct application UPDATE.
    supersededBy: uuid("superseded_by"),
    supersededByCreatedAt: timestamp("superseded_by_created_at", { withTimezone: true }), // set atomically with supersededBy, see previousObservationCreatedAt comment
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }), // composite per ADR-0008 (partition key must be part of the PK)
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
    foreignKey({
      columns: [table.previousObservationId, table.previousObservationCreatedAt],
      foreignColumns: [table.id, table.createdAt],
      name: "observation_previous_observation_id_created_at_fk",
    }),
    foreignKey({
      columns: [table.amendmentOf, table.amendmentOfCreatedAt],
      foreignColumns: [table.id, table.createdAt],
      name: "observation_amendment_of_created_at_fk",
    }),
    foreignKey({
      columns: [table.supersededBy, table.supersededByCreatedAt],
      foreignColumns: [table.id, table.createdAt],
      name: "observation_superseded_by_created_at_fk",
    }),
    tenantIsolation(),
  ],
).enableRLS();
