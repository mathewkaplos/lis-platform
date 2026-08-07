import { pgTable, uuid, text, numeric, timestamp, index, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte, unit } from "./catalog";

// Tenant-scoped per ADR-0004 (contrast case): labs configure their own
// control lots, unlike analyte/unit (global reference data). Same pattern as
// reference_range.ts.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-27 / ADR-0015: a control lot defines, per analyte/instrument/level, the
// target mean and SD a QC Observation is evaluated against (Westgard
// evaluation itself is FEAT-019, not built here). instrumentId deliberately
// has no FK, mirroring observation.instrumentId's own already-precedented
// "no instrument table exists yet" gap (KB-28 unbuilt) -- not a new one.
export const controlLot = pgTable(
  "control_lot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    level: text("level").notNull(), // e.g. low|normal|high -- free text, no rule-pack metadata exists yet
    instrumentId: uuid("instrument_id"), // no FK: no instrument table exists yet, see observation.instrumentId
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    targetMean: numeric("target_mean").notNull(),
    targetSd: numeric("target_sd").notNull(),
    lotNumber: text("lot_number").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_control_lot_tenant_analyte").on(table.tenantId, table.analyteId), tenantIsolation()],
).enableRLS();
