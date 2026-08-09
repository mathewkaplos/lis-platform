import { pgTable, uuid, text, numeric, timestamp, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte } from "./catalog";

// Tenant-scoped per ADR-0023 (contrast case, same reasoning as
// reference_range's own header comment): labs tune their own delta-check
// sensitivity, unlike analyte/unit (global reference data, ADR-0004).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// ADR-0023: percent-only threshold, one row per (tenant, analyte) — no
// sex/age/condition dimensions in v1 (unlike reference_range), so a single
// unique index is the whole resolution story; no specificity-scoring
// resolver needed. Absolute-threshold and time-windowed lookback are named,
// deferred future work (ADR-0023's own "why not" section), not built here.
export const deltaCheckRule = pgTable(
  "delta_check_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    thresholdPercent: numeric("threshold_percent").notNull(),
    source: text("source"), // citation / validation reference, mirrors reference_range.source
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_delta_check_rule_tenant_analyte").on(table.tenantId, table.analyteId), tenantIsolation()],
).enableRLS();
