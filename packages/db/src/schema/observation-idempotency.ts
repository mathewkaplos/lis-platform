import { pgTable, uuid, text, timestamp, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant-scoped per ADR-0004 (operational, tenant-varying data).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-027 (ADR-0026, analyzer-integration Skill entry #3): real,
// DB-enforced dedupe for analyzer-ingested results, replacing FEAT-026's
// in-memory-only stub. A deliberately separate, non-partitioned table --
// `observation` itself can't carry this uniqueness guarantee: Postgres
// requires every unique index on a partitioned table to include the
// partition key (created_at, ADR-0008), which would let two genuinely
// duplicate writes (different created_at, same idempotency key) both
// insert, defeating the point. This table has no such constraint, so a
// plain (tenant_id, source_idempotency_key) unique index does what it says.
//
// `observationId` is a plain uuid, not FK'd to `observation.id` -- the same
// pragmatic "no FK yet" precedent already used elsewhere in this schema for
// non-clinical bookkeeping columns (observation.methodId/instrumentId): a
// real FK to `observation` would need the same companion-created_at-column
// treatment ADR-0008's addendum already applies to previousObservationId/
// amendmentOf/supersededBy, for a table whose sole purpose is a uniqueness
// guard, not a clinical relationship. Written in the same transaction as
// the `Observation` insert it guards.
export const observationIdempotencyKey = pgTable(
  "observation_idempotency_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    sourceIdempotencyKey: text("source_idempotency_key").notNull(),
    observationId: uuid("observation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_observation_idempotency_key_tenant_key").on(table.tenantId, table.sourceIdempotencyKey),
    tenantIsolation(),
  ],
).enableRLS();
