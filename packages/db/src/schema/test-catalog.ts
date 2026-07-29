import { pgTable, uuid, text, timestamp, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte } from "./catalog";

// Tenant-scoped per ADR-0004: labs define their own test menus and panels,
// unlike analyte/unit/code_system_value (global reference data).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

export const testDefinition = pgTable(
  "test_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_test_definition_tenant_code").on(table.tenantId, table.code), tenantIsolation()],
).enableRLS();

// TestDefinition *..* AnalyteDefinition (KB-02 §Aggregate: TestDefinition).
export const testAnalyte = pgTable(
  "test_analyte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinition.id),
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_test_analyte_test_definition_analyte").on(table.testDefinitionId, table.analyteId), tenantIsolation()],
).enableRLS();

export const panel = pgTable(
  "panel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_panel_tenant_code").on(table.tenantId, table.code), tenantIsolation()],
).enableRLS();

// PanelDefinition *..* TestDefinition (KB-02 line 159).
export const panelTest = pgTable(
  "panel_test",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panel.id),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinition.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_panel_test_panel_test_definition").on(table.panelId, table.testDefinitionId), tenantIsolation()],
).enableRLS();
