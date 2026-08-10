import { pgTable, uuid, text, integer, timestamp, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orderedTest } from "./order";

// Tenant-scoped per ADR-0004, same pattern as critical_notification --
// operational, tenant-varying clinical-workflow data. `lis_app`-only; the
// detector's own phase-1 enumeration reads `ordered_test` directly (its own
// widened scheduler_enumeration policy, order.ts), never this table --
// `sla_breach` rows are only ever written by phase 2, as `lis_app`, fully
// RLS-scoped, exactly like every other write in this repo.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md).
// `priority`/`targetMinutes` are denormalized at breach time, not read live
// from `sla_target` -- same reasoning `workflow_definition` versioning
// already established: a later `sla_target` edit must never rewrite what a
// past breach's own record says was true when it fired. `orderedTestId` is
// a plain single-column FK (unlike `critical_notification`'s composite FK
// to `observation`) -- `ordered_test` is not partitioned, confirmed by
// reading its own schema directly before assuming the same composite-PK
// shape `observation`/`result_history`/`critical_notification` all share.
export const slaBreach = pgTable(
  "sla_breach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderedTestId: uuid("ordered_test_id")
      .notNull()
      .references(() => orderedTest.id),
    priority: text("priority").notNull(), // 'routine' | 'stat', denormalized -- see header comment
    targetMinutes: integer("target_minutes").notNull(), // denormalized, see header comment
    breachedAt: timestamp("breached_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'escalated' | 'resolved'
    escalationLevel: integer("escalation_level").notNull().default(0),
    lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one non-resolved breach per ordered_test -- same "reuse the
    // existing row, don't spawn a duplicate" precedent
    // `criticalNotification`'s own insert-or-reuse check already
    // established, enforced here as a real constraint (partial unique
    // index) rather than only an application-level check, since the
    // detector's own phase 2 runs on an unconditioned interval and must
    // never race itself into a duplicate.
    uniqueIndex("ux_sla_breach_ordered_test_open")
      .on(table.orderedTestId)
      .where(sql`${table.status} <> 'resolved'`),
    check("ck_sla_breach_priority", sql`${table.priority} IN ('routine', 'stat')`),
    check("ck_sla_breach_status", sql`${table.status} IN ('pending', 'escalated', 'resolved')`),
    tenantIsolation(),
  ],
).enableRLS();
