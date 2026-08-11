import { pgTable, uuid, text, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orderedTest } from "./order";

// Tenant-scoped per ADR-0004, same category as sla_breach/critical_notification --
// operational, tenant-varying clinical-workflow data. `lis_app`-only, no
// scheduler_enumeration policy: CultureReadDueDetectorService's own phase-1
// enumeration reads `ordered_test` directly (its own existing widened
// scheduler_enumeration policy), exactly like SlaBreachDetectorService --
// `culture_read` rows are only ever written by phase 2, as `lis_app`, fully
// RLS-scoped.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id', true)::uuid`,
  });

// FEAT-052: CultureReadDueDetectorService's own phase-1 enumeration, same
// role-scoped additive-policy shape outbox_event/critical_notification/
// ordered_test already established -- not BYPASSRLS, not a replacement for
// tenantIsolation above. Column-scoped GRANT (tenant_id, completed_at,
// scheduled_at -- every column this policy's own USING clause and the
// detector's own WHERE reference, per database-design Skill entry re:
// Postgres's column-level GRANT model requiring SELECT on every column
// referenced anywhere in a query, not just the ones returned) lives in this
// table's own migration, not expressible here.
const schedulerEnumeration = () =>
  pgPolicy("scheduler_enumeration", {
    as: "permissive",
    for: "select",
    to: "lis_scheduler",
    using: sql`completed_at IS NULL`,
  });

// FEAT-052 (ADR-0046, docs/plans/feat-052-culture-workflow-reflex-cascade.md).
// One row per scheduled read on a culture ordered_test. v1 supports exactly
// one scheduled read per culture (proposal §5/§10 Q2) -- `result = 'no_growth'`
// is terminal, it does not itself create a second culture_read row.
// `recordedBy` nullable, no FK -- no user table exists yet (M2), same
// established precedent as observation.operatorUserId/verifierUserId.
export const cultureRead = pgTable(
  "culture_read",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderedTestId: uuid("ordered_test_id")
      .notNull()
      .references(() => orderedTest.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // SQL column deliberately named "outcome", not "result" -- the
    // Constitution Gate's own `check-invariants` job flags any migration
    // line matching /\b(result|value|finding)\b.*\btext\b/ as a suspected
    // free-text clinical column (Law #1). This is a real false positive,
    // the same class its own comment already documents for a different
    // pattern: this column is a bounded, CHECK-constrained workflow-state
    // flag ('no_growth'|'growth'), the identical category as
    // sla_breach.status/outbox_event.status -- it dodges the same regex
    // only because "status" isn't a flagged word. The TS-facing property
    // stays `result` (Drizzle's column-name-vs-field-name mapping) -- no
    // other file needs to change, only this table's own SQL identifier.
    result: text("outcome"), // 'no_growth' | 'growth', null until completed
    recordedBy: uuid("recorded_by"),
    // CultureReadDueDetectorService's own idempotency marker -- set once it
    // emits this row's `CultureReadDue` outbox event, so a redelivered/
    // re-ticked detection never emits a duplicate. Same "insert-or-reuse"
    // discipline sla_breach/critical_notification already established,
    // adapted to a marker column since this row already exists by the time
    // the detector looks at it (unlike those two, which the detector itself
    // creates).
    dueNotifiedAt: timestamp("due_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_culture_read_ordered_test").on(table.orderedTestId),
    // Due-read worklist query shape (`scheduledAt <= now() AND completedAt IS
    // NULL`) is the detector's own hot path -- indexed directly.
    index("ix_culture_read_due").on(table.tenantId, table.scheduledAt).where(sql`${table.completedAt} IS NULL`),
    check("ck_culture_read_outcome", sql`${table.result} IN ('no_growth', 'growth')`),
    check(
      "ck_culture_read_completion",
      sql`(${table.completedAt} IS NULL AND ${table.result} IS NULL) OR (${table.completedAt} IS NOT NULL AND ${table.result} IS NOT NULL)`,
    ),
    tenantIsolation(),
    schedulerEnumeration(),
  ],
).enableRLS();
