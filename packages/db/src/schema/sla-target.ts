import { pgTable, uuid, text, integer, timestamp, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant-scoped per ADR-0024 (same reasoning as delta_check_rule, ADR-0023):
// labs tune their own turnaround targets per priority.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-022 proposal §10 Q2 (approved): priority-keyed only (no per-discipline/
// per-test-type axis in v1), one row per (tenant, priority). At-risk is a
// fixed 80% ratio of targetMinutes computed at read time, not a second
// stored column -- matches FEAT-017's own "don't over-build config ahead of
// a real need" precedent.
export const slaTarget = pgTable(
  "sla_target",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    priority: text("priority").notNull(), // routine|stat, mirrors order.priority's own CHECK-constrained domain
    targetMinutes: integer("target_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_sla_target_tenant_priority").on(table.tenantId, table.priority),
    check("ck_sla_target_priority", sql`${table.priority} IN ('routine', 'stat')`),
    tenantIsolation(),
  ],
).enableRLS();
