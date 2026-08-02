import { pgTable, uuid, text, timestamp, index, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { testDefinition } from "./test-catalog";
import { patient } from "./patient";

// Tenant-scoped per ADR-0004 (contrast case): orders/ordered tests are
// operational, tenant-varying clinical-workflow data.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-02 Order aggregate. patient_id's forward-reference FK is backfilled by
// this task (TASK-038, FEAT-011 proposal §5 — not literally named in
// ADR-0005's own acceptance criteria, which only lists observation's
// columns, but this column's comment independently cited the same ADR and
// gets the identical treatment for consistency). Scope deliberately excludes
// priority, clinical notes, diagnosis codes, billing linkage, and
// ordering-provider reference — none has consuming code or a catalog table
// yet anywhere in this repo (FEAT-006 proposal §5/§10 Q3).
export const order = pgTable(
  "order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id), // FK backfilled by TASK-038, see ADR-0005
    status: text("status").notNull().default("pending"), // full state machine (KB-03) deferred, see FEAT-006 proposal §5
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolation()],
).enableRLS();

// KB-02: OrderedTest is a single test/panel requested within an Order, with
// its own status; references TestDefinition by ID (catalog vs. operational
// split).
export const orderedTest = pgTable(
  "ordered_test",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinition.id),
    status: text("status").notNull().default("pending"), // full state machine (KB-03) deferred, see FEAT-006 proposal §5
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_ordered_test_order").on(table.orderId), tenantIsolation()],
).enableRLS();
