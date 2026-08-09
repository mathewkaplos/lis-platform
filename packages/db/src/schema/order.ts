import { pgTable, uuid, text, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
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
// TASK-038 (FEAT-011 proposal §5 — not literally named in ADR-0005's own
// acceptance criteria, which only lists observation's columns, but this
// column's comment independently cited the same ADR and gets the identical
// treatment for consistency). priority added by TASK-042 (FEAT-012 proposal
// §1/§5) — required by FEAT-012's own AC ("Order list filters correctly by
// status, priority, and date range"); KB-03's own variant-workflow table
// names 'routine'/'STAT' as the two real values. Order-level status has no
// canonical state machine of its own in KB-03 (only OrderedTest/Specimen/
// Observation/Report do) — TASK-042 writes only 'ordered' (create) and
// 'cancelled' (cascade cancel, all ordered_test rows cancelled), so the
// CHECK constraint below is scoped to exactly those two values, not a wider
// speculative set. Scope still deliberately excludes clinical notes,
// diagnosis codes, billing linkage, and ordering-provider reference — none
// has consuming code or a catalog table yet anywhere in this repo (FEAT-006
// proposal §5/§10 Q3).
export const order = pgTable(
  "order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id), // FK backfilled by TASK-038, see ADR-0005
    status: text("status").notNull().default("ordered"), // 'ordered' | 'cancelled' (TASK-042; see header comment)
    priority: text("priority").notNull().default("routine"), // 'routine' | 'stat' (KB-03), TASK-042
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_order_status", sql`${table.status} IN ('ordered','cancelled')`),
    check("ck_order_priority", sql`${table.priority} IN ('routine','stat')`),
    tenantIsolation(),
  ],
).enableRLS();

// KB-02: OrderedTest is a single test/panel requested within an Order, with
// its own status; references TestDefinition by ID (catalog vs. operational
// split). status's full canonical value set is KB-03's own OrderedTest state
// machine (03-business-workflows.md:68-73); TASK-042 (FEAT-012 proposal §5)
// wrote the first real rows ('ordered' on create, 'cancelled' on cascade
// cancel). Real writers since then (verified directly against code, not
// assumed from this comment — FEAT-017/TASK-061 proposal finding #1):
// 'received'/'rejected' by TASK-047 reception (specimen.controller.ts),
// 'in_process' by TASK-051 draft-save (observation.controller.ts),
// 'resulted' by TASK-056's finalization roll-up
// (finalization-rollup.interceptor.ts), gated on Constitution Law #3. Only
// 'collected' and 'reported' remain unwritten; this row's own status never
// reaches a literal 'verified' value — that's tracked per-analyte on
// observation.status instead.
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
    status: text("status").notNull().default("ordered"), // TASK-042; see header comment for the full canonical set
    // FEAT-022 (ADR-0024): no FK -- no user table exists yet (M2), same
    // established precedent as observation.operatorUserId/verifierUserId.
    // Set only via POST /v1/worklist/bulk-assign; v1's own UI only ever
    // sends the caller's own JWT sub (self-assign), though the column/API
    // accept any uuid (ADR-0024 decision 2).
    assignedUserId: uuid("assigned_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_ordered_test_order").on(table.orderId),
    check(
      "ck_ordered_test_status",
      sql`${table.status} IN ('ordered','collected','received','in_process','resulted','verified','reported','cancelled','rejected')`,
    ),
    tenantIsolation(),
  ],
).enableRLS();
