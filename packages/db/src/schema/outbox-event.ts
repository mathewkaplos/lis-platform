import { pgTable, uuid, text, integer, jsonb, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant-scoped per ADR-0004: operational, tenant-varying event data.
//
// Uses current_setting(..., missing_ok=true) -- not the 1-arg default every
// other table starts with -- from this table's very first migration.
// critical_notification.ts already found the hard way (ADR-0017, migration
// 0019) that the 1-arg form *throws* "unrecognized configuration parameter"
// when app.tenant_id was never set in the session at all (not merely
// null/false), and Postgres aborts a whole query on an exception from any
// one PERMISSIVE policy's USING clause even though multiple PERMISSIVE
// policies are otherwise OR'd together. lis_scheduler never sets
// app.tenant_id (no single tenant -- that's the point of the
// scheduler_enumeration policy below), so its queries against this table
// would hit that exact bug on tenant_isolation's own clause before
// scheduler_enumeration is ever evaluated. Starting with the 2-arg form
// here (ADR-0028) avoids reproducing a bug this repo already paid to find
// and fix once, on the sibling table this one's relay design is modeled on.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id', true)::uuid`,
  });

// ADR-0017/ADR-0028: a second, role-scoped, additive policy -- not a
// replacement for tenant_isolation above, and not BYPASSRLS. Reuses the
// existing lis_scheduler role (no new role for this feature) exactly as
// critical_notification.ts's own schedulerEnumeration() does. Column-scoped
// GRANT (SELECT (tenant_id) only, see this table's migration) means
// lis_scheduler cannot read event_type/payload/anything else even where
// this policy's rows are visible.
const schedulerEnumeration = () =>
  pgPolicy("scheduler_enumeration", {
    as: "permissive",
    for: "select",
    to: "lis_scheduler",
    using: sql`status = 'pending'`,
  });

// FEAT-028 (ADR-0028): the transactional outbox. writeOutboxEvent()
// (packages/db/src/outbox.ts) inserts a row in the same transaction as the
// domain change it accompanies -- KB-25's "an event and its triggering
// state change commit atomically or not at all." OutboxRelayService
// (apps/api/src/outbox/) polls pending rows and dispatches to registered
// handlers; a handler exception increments attempts/lastError, leaving the
// row pending for retry (at-least-once, no dead-letter queue this phase).
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    eventType: text("event_type").notNull(), // e.g. 'ObservationVerified' -- KB-25's own event-name vocabulary
    payload: jsonb("payload").notNull(), // snapshot at write time, never recomputed -- same discipline as audit_event before/after
    status: text("status").notNull().default("pending"), // 'pending' | 'processed' -- bounded text, not a native enum (ADR-0006 scopes that to observation.data_type only)
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    // Partial index: the relay's own enumeration/processing query scans
    // exactly this predicate -- mirrors ix_critical_notification_pending.
    index("ix_outbox_event_pending")
      .on(table.tenantId, table.status)
      .where(sql`${table.status} = 'pending'`),
    check("ck_outbox_event_status", sql`${table.status} IN ('pending','processed')`),
    tenantIsolation(),
    schedulerEnumeration(),
  ],
).enableRLS();
