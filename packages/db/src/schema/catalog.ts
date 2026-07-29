import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Global reference tables — no tenant_id, no RLS.
// Reasoning recorded in ADR-0004: these hold coding-standard reference data
// (LOINC, UCUM) that is identical across every tenant, unlike reference_range
// and test_definition/panel, which are genuinely tenant-customizable.

export const codeSystemValue = pgTable(
  "code_system_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    system: text("system").notNull(),
    code: text("code").notNull(),
    version: text("version").notNull(),
    display: text("display").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_code_system_value_system_code_version").on(table.system, table.code, table.version)],
);

export const unit = pgTable("unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeSystemValueId: uuid("code_system_value_id")
    .notNull()
    .references(() => codeSystemValue.id),
  displayOverride: text("display_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analyte = pgTable("analyte", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeSystemValueId: uuid("code_system_value_id")
    .notNull()
    .references(() => codeSystemValue.id)
    .unique(),
  display: text("display").notNull(),
  dataType: text("data_type").notNull(), // quantity|coded|ordinal|boolean|text|table|structured|attachment|ratio|datetime — mirrors observation.data_type (KB-06)
  defaultUnitId: uuid("default_unit_id").references(() => unit.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
