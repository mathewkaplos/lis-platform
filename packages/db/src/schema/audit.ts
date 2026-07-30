import { pgTable, uuid, text, timestamp, jsonb, bigserial, index, pgPolicy, check, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// `pg` (node-postgres) round-trips bytea <-> Buffer natively; drizzle has no
// built-in bytea helper, so this is a minimal customType rather than a
// deviation to text.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// KB-11 Audit Logging's `audit.event` record, adapted to this repo's
// conventions:
// - id is uuid v4 (gen_random_uuid), not KB-11's literal `uuid v7`, per
//   FEAT-006 proposal §10 Q1 — avoids taking on pg_uuidv7 as this repo's
//   first new Postgres extension dependency. `sequence` (a plain global
//   bigserial) provides the guaranteed monotonic ordering v7 would have
//   given via the id itself; hash-chain correctness comes from
//   prev_hash/hash, not id sortability, so this doesn't weaken tamper
//   evidence. A single global counter is also sufficient for *per-tenant*
//   chronological ordering (KB-11: "forming a chain per tenant") — it only
//   ever increases, so filtering WHERE tenant_id = X ORDER BY sequence still
//   gives that tenant's correct chronological order.
// - actor { principal_id, role, type } and resource { type, id } are
//   flattened onto plain columns — no nested composite-type convention
//   exists anywhere else in this schema. actor_type is CHECK-constrained
//   text (3 bounded values: human|service|ai), matching the
//   specimen.status/rejection_reason precedent (ADR-0006 scopes this repo's
//   one ENUM decision to observation.data_type only, not a general license).
// - context stays jsonb: request_id/session_ref/source_ip/client/step_up
//   genuinely varies per action and is never cross-record trended — KB-06's
//   own JSONB carve-out applies directly.
// - action/resource_type are plain text, not a clinical value: Constitution
//   Law #1 governs clinical *results*, not audit-trail action labels (same
//   reasoning already applied to order/specimen.status in TASK-023).
// - No FK on resource_id: the audited resource can be any of many tables
//   (observation, report, specimen, ...), which this repo has no
//   discriminated-union FK mechanism for.
// - No DB-trigger backstop yet (KB-11 lists app events + DB triggers as
//   defence in depth): no application-level audited action exists yet to
//   backstop at this milestone — this table + the writer function below is
//   the full TASK-025 scope.
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
    tenantId: uuid("tenant_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    actorPrincipalId: uuid("actor_principal_id").notNull(),
    actorRole: text("actor_role").notNull(),
    actorType: text("actor_type").notNull(), // human|service|ai

    action: text("action").notNull(), // e.g. 'observation.amend', 'report.finalize'
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),

    before: jsonb("before"), // null for create/access actions with no prior state
    after: jsonb("after"), // null for delete/access actions with no new state
    reason: text("reason"), // required for amendments/break-glass — enforced by the writer, not a blanket NOT NULL

    context: jsonb("context"), // { request_id, session_ref, source_ip, client, step_up? }

    prevHash: bytea("prev_hash"), // null only for the first event in a tenant's chain
    hash: bytea("hash").notNull(), // sha256(canonical(record) || prev_hash), see src/audit.ts
  },
  (table) => [
    index("ix_audit_event_tenant_sequence").on(table.tenantId, table.sequence),
    check("ck_audit_event_actor_type", sql`${table.actorType} IN ('human','service','ai')`),
    tenantIsolation(),
  ],
).enableRLS();
