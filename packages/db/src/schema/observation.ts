import { pgTable, pgEnum, uuid, text, numeric, boolean, jsonb, timestamp, index, pgPolicy, check, primaryKey, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte, unit } from "./catalog";
import { patient } from "./patient";
import { controlLot } from "./control-lot";
import { orderedTest } from "./order";
import { specimen } from "./specimen";

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
// / specimen_id's forward-reference FK (ADR-0005) is backfilled here (issue
// #260's fix), same as patient_id's own backfill below (TASK-038).
//
// patient_id/ordered_test_id/specimen_id are nullable per ADR-0015: a QC
// Observation (is_control = true) has none of these -- it has a control_lot
// instead. chk_observation_subject enforces every row is unambiguously
// either a patient result or a QC result, never neither, never both. Any
// query written before ADR-0015 that assumed patient_id is always present
// must now filter is_control = false explicitly (domain/qc-westgard Skill
// entry #1).
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

    orderedTestId: uuid("ordered_test_id").references(() => orderedTest.id), // nullable per ADR-0015 (null for QC rows)
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    specimenId: uuid("specimen_id").references(() => specimen.id), // nullable per ADR-0015 (null for QC rows)
    patientId: uuid("patient_id").references(() => patient.id), // FK backfilled by TASK-038, see ADR-0005; nullable per ADR-0015 (null for QC rows)

    // ADR-0015 (FEAT-018/TASK-063): QC subject columns. isControl is an
    // explicit discriminator (not inferred from nullability), matching this
    // schema's own "explicit unknown/state" discipline (patient.sex = 'U').
    isControl: boolean("is_control").notNull().default(false),
    controlLotId: uuid("control_lot_id").references(() => controlLot.id), // set only when isControl = true

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
    // FEAT-042 (KB-11's "every AI suggestion and its human disposition"):
    // set only on 'ordinal' rows whose notes originated from
    // InferenceGatewayService's draft-narrative capability, accepted
    // verbatim or edited before finalizing. A rejected draft (technologist
    // types their own note instead) leaves both null -- there is nothing
    // AI-originated left in the final value to label.
    notesAiOriginated: boolean("notes_ai_originated").notNull().default(false),
    notesAiDisposition: text("notes_ai_disposition"), // 'accepted'|'edited', null unless notesAiOriginated
    // FEAT-027 (ADR-0026, analyzer-integration Skill entry #3): the
    // driver-computed idempotency key (instrument_id:specimen_id:analyte:
    // run_id, @lis/domain's rawResultIdempotencyKey), set only on
    // analyzer-originated writes -- null for manual/calculated ones.
    // Traceability only -- NOT uniquely constrained here: Postgres requires
    // every unique index on a partitioned table to include the partition key
    // (created_at), which would let two duplicate-key rows with different
    // created_at values both insert, defeating the point. Real dedupe is
    // enforced by `observationIdempotencyKey` (observation-idempotency.ts),
    // a separate, non-partitioned table with a plain (tenant_id,
    // source_idempotency_key) unique constraint, written in the same
    // transaction as the Observation it guards.
    sourceIdempotencyKey: text("source_idempotency_key"),
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
    // Bare column names, not the usual ${table.column} interpolation --
    // database-design Skill entry #9: a CHECK added via a standalone ALTER
    // TABLE (this table already existed) cannot table-qualify columns the
    // way one embedded in the original CREATE TABLE can.
    check(
      "ck_observation_notes_ai_disposition",
      sql`(notes_ai_originated = false AND notes_ai_disposition IS NULL) OR (notes_ai_originated = true AND notes_ai_disposition IN ('accepted', 'edited'))`,
    ),
    // ADR-0015: every row is unambiguously a patient result or a QC result,
    // never neither, never both -- structural, not an application-level
    // convention (Constitution Law #4's own "structural, not an if check"
    // framing, applied here to subject-type integrity).
    //
    // Deliberately unqualified column names (not the usual ${table.column}
    // interpolation this file uses everywhere else): this constraint is
    // added via a later ALTER TABLE ADD CONSTRAINT (this table already
    // existed before ADR-0015), not embedded inside the original CREATE
    // TABLE the way ck_observation_*_value above are. Postgres only permits
    // table-qualified column references ("observation"."col") inside a CHECK
    // clause that's part of the same CREATE TABLE statement -- in a
    // standalone ALTER TABLE ADD CONSTRAINT, a qualified reference errors
    // with "missing FROM-clause entry for table observation" (confirmed
    // against a real migration run, not assumed). Bare column names are
    // required here and work correctly either way.
    check(
      "chk_observation_subject",
      sql`(is_control = false AND patient_id IS NOT NULL AND control_lot_id IS NULL) OR (is_control = true AND patient_id IS NULL AND control_lot_id IS NOT NULL)`,
    ),
    // MATCH FULL per ADR-0008's second addendum -- not representable by
    // drizzle-kit's foreignKey() builder (no `match` option), so
    // db/migrations/0011_observation_fk_integrity.sql hand-adds it after this
    // constraint is created; this declaration models the columns only, same
    // "drizzle can't express it, hand-written SQL is the source of truth"
    // pattern as this file's PARTITION BY note above. Without MATCH FULL,
    // Postgres's default MATCH SIMPLE skips the whole FK check whenever the
    // companion *_created_at column is NULL -- which is exactly the state
    // fn_observation_link_created_at leaves it in when the caller-supplied id
    // doesn't exist, silently letting a bad id through.
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
