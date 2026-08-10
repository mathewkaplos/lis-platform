import { pgTable, uuid, text, integer, timestamp, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

/**
 * FEAT-039 (proposal §10 Q1, resolved): one row per tenant, same shape
 * precedent as `sla_target` (a single tenant-tunable config value, uuid
 * `id` PK + a unique index enforcing "one row per tenant"). No existing
 * precedent for a result-release-policy concept anywhere in this codebase
 * before this task -- KB-32's own much larger "jurisdiction-aware release
 * rules" target is the destination; this is a deliberately minimal v1
 * slice (`immediate` | `delayed` + a flat delay, not a rules engine).
 *
 * No admin UI/endpoint changes this in v1 -- direct DB update only, same
 * "prove the mechanism, defer real provisioning" precedent
 * `care_relationship`/`patient_portal_account` already established.
 */
export const resultReleasePolicy = pgTable(
  "result_release_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    mode: text("mode").notNull().default("immediate"), // immediate|delayed
    delayHours: integer("delay_hours").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_result_release_policy_tenant").on(table.tenantId),
    check("ck_result_release_policy_mode", sql`${table.mode} IN ('immediate', 'delayed')`),
    tenantIsolation(),
  ],
).enableRLS();
