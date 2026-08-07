import { pgTable, uuid, text, integer, timestamp, index, pgPolicy, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { observation } from "./observation";

// Tenant-scoped per ADR-0004: operational, tenant-varying clinical data,
// same pattern as observation/control_lot.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// ADR-0016 / KB-34: the notification/read-back/escalation half of
// Constitution Law #3 -- decoupled from `observation.verify()` on purpose
// (see the ADR's own "Alternatives rejected"). Bounded-text status, not a
// native enum, matching `audit_event.actor_type`'s own precedent (ADR-0006
// scopes this schema's one enum decision to `observation.data_type` only).
// `escalationLevel`/`lastEscalatedAt` exist now (schema-complete per this
// task's own migration) but are only ever written by TASK-066's escalation
// timer -- this task's own creation hook and acknowledge action never touch
// them, matching this proposal's own "schema first, later task is the
// writer" precedent (ADR-0015's `control_lot.instrumentId` is the same
// shape: a column with no writer yet in this task).
export const criticalNotification = pgTable(
  "critical_notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    observationId: uuid("observation_id").notNull(), // the observation this notification is about
    // Companion to observationId, per ADR-0008's addendum (same pattern as
    // result_history.observationCreatedAt): observation's primary key is
    // composite (id, created_at) post-partitioning, so a single-column FK to
    // observation.id is impossible -- confirmed the hard way, a real failed
    // migration run ("there is no unique constraint matching given keys for
    // referenced table observation"), not anticipated in this task's own
    // proposal/ADR. Always set atomically from the same just-written
    // observation row finalize() already has in hand, never a caller-
    // supplied lookup -- MATCH SIMPLE (drizzle-kit's default) and MATCH FULL
    // are equivalent here, same reasoning result_history's own
    // superseded_by_created_at documents, so no hand-written MATCH FULL
    // migration line is needed.
    observationCreatedAt: timestamp("observation_created_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'acknowledged' | 'escalated'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    escalationLevel: integer("escalation_level").notNull().default(0),
    lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id"),
    readBack: text("read_back"), // required by the acknowledge writer, not a blanket NOT NULL -- same precedent as audit_event.reason
  },
  (table) => [
    index("ix_critical_notification_tenant_observation").on(table.tenantId, table.observationId),
    // Partial index, not a full one: TASK-066's escalation-timer query scans
    // exactly this predicate ("what's still outstanding"); pending/escalated
    // rows are a small, bounded working set relative to the table's full
    // history once acknowledged rows accumulate.
    index("ix_critical_notification_pending")
      .on(table.tenantId, table.status)
      .where(sql`${table.status} <> 'acknowledged'`),
    check("ck_critical_notification_status", sql`${table.status} IN ('pending','acknowledged','escalated')`),
    foreignKey({
      columns: [table.observationId, table.observationCreatedAt],
      foreignColumns: [observation.id, observation.createdAt],
      name: "critical_notification_observation_id_created_at_fk",
    }),
    tenantIsolation(),
  ],
).enableRLS();
