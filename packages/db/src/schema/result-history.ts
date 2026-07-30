import { pgTable, uuid, numeric, boolean, text, jsonb, timestamp, index, pgPolicy, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { observation, observationDataType } from "./observation";

const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// Populated only by fn_observation_supersede (TASK-021): whenever a
// correction supersedes an observation, its final state is archived here
// before superseded_by is set, giving a queryable version trail (KB-06/KB-14
// "OBSERVATION versions RESULT_HISTORY") without walking amendment_of/
// superseded_by pointer chains. This is an archival copy of already
// CHECK-validated data, not a new write path -- no per-data_type CHECK
// constraints are duplicated here.
export const resultHistory = pgTable(
  "result_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    observationId: uuid("observation_id").notNull(), // the version being archived
    // Companion to observationId, per ADR-0008's addendum: observation's
    // primary key is composite (id, created_at) post-partitioning, so this
    // FK must be composite too. Set by fn_observation_supersede alongside
    // observationId — both selected from the same source row.
    observationCreatedAt: timestamp("observation_created_at", { withTimezone: true }).notNull(),

    dataType: observationDataType("data_type").notNull(),
    valueNum: numeric("value_num"),
    valueCode: text("value_code"),
    valueBool: boolean("value_bool"),
    valueText: text("value_text"),
    valueDatetime: timestamp("value_datetime", { withTimezone: true }),
    valueJson: jsonb("value_json"),

    status: text("status").notNull(),
    supersededBy: uuid("superseded_by").notNull(), // the observation that replaced it, snapshotted at archive time

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_result_history_observation").on(table.observationId),
    foreignKey({
      columns: [table.observationId, table.observationCreatedAt],
      foreignColumns: [observation.id, observation.createdAt],
      name: "result_history_observation_id_created_at_fk",
    }),
    tenantIsolation(),
  ],
).enableRLS();
