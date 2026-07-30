import { pgTable, uuid, text, integer, numeric, timestamp, index, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte, unit } from "./catalog";

// Tenant-scoped per ADR-0004 (contrast case): labs validate their own ranges
// (KB-15), unlike analyte/unit/code_system_value (global reference data).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-15 multi-dimensional model. Age is canonicalized to days at write time
// (rather than storing a raw value + ageUnit) so resolution is a plain
// integer-range comparison, matching how `unit` already canonicalizes UCUM
// units instead of storing per-row unit strings. `method`, `specimenType`,
// and `population` are free-text labels, not clinical result values (Law #1
// concerns Observations, not catalog/config rows) — they stay plain text
// until a method/specimen catalog exists (no such table in M1).
export const referenceRange = pgTable(
  "reference_range",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    sex: text("sex"), // 'M' | 'F' | null = any
    ageLowDays: integer("age_low_days"),
    ageHighDays: integer("age_high_days"),
    condition: text("condition"), // coded label, e.g. pregnancy_trimester_2, fasting
    method: text("method"),
    specimenType: text("specimen_type"),
    population: text("population"),
    rangeType: text("range_type").notNull(), // normal|therapeutic|critical|reportable_absurd
    low: numeric("low"),
    high: numeric("high"),
    textualRange: text("textual_range"), // non-numeric expected value, e.g. "Not detected"
    interpretationWhenIn: text("interpretation_when_in"),
    priority: integer("priority").notNull().default(0),
    source: text("source"), // citation / validation reference
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_reference_range_tenant_analyte").on(table.tenantId, table.analyteId), tenantIsolation()],
).enableRLS();
