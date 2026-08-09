import { pgTable, uuid, text, integer, numeric, timestamp, uniqueIndex, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte, unit } from "./catalog";

// Tenant-scoped per ADR-0004 (contrast case, same reasoning as
// delta_check_rule/reference_range): each lab configures its own
// instrument's channel-code -> analyte mapping, unlike analyte/unit (global
// reference data).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-027 (KB-29 "versioned mapping metadata"): the minimal real
// infrastructure a driver needs to translate an instrument's own channel
// code into the canonical Analyte/unit model, without a code deploy per
// instrument onboarding (KB-29's own stated point). No `instrument` catalog
// table exists yet (`instrumentId` is a plain string, same "no FK, no
// catalog table" precedent as observation.instrumentId/methodId) --
// `instrumentId` here is just a caller-supplied identifier, not a foreign
// key.
//
// `conversionFactor` (FEAT-027 proposal §10 Q1): a plain
// `instrument_value * conversionFactor = canonical_value` multiply, not a
// full unit-conversion engine (none exists anywhere in this codebase --
// see the analyzer-integration Skill entry #3's own note). Defaults to 1,
// the common case where the instrument already reports in the analyte's
// canonical unit.
//
// `status`/`version` mirror KB-29's own versioning language: a mapping row
// is `draft` while being configured, `published` when live (the only status
// a driver's correlation step reads from), `archived` once superseded --
// never deleted, so a historical result's mapping stays traceable (same
// "snapshot, never recompute" discipline observation.ts's own ref_low/
// ref_high columns already follow).
export const instrumentAnalyteMapping = pgTable(
  "instrument_analyte_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    channelCode: text("channel_code").notNull(),
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    conversionFactor: numeric("conversion_factor").notNull().default("1"),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A given (instrument, channel code) may only have one *published*
    // mapping at a time per tenant -- enforced via a partial unique index
    // rather than a plain one, since draft/archived versions of the same
    // channel code coexisting is the whole point of versioning (KB-29:
    // "a firmware change that alters a channel code is handled by
    // publishing a new mapping version").
    uniqueIndex("ux_instrument_mapping_published")
      .on(table.tenantId, table.instrumentId, table.channelCode)
      .where(sql`${table.status} = 'published'`),
    index("ix_instrument_mapping_lookup").on(table.tenantId, table.instrumentId, table.channelCode, table.status),
    check("ck_instrument_mapping_status", sql`${table.status} IN ('draft','published','archived')`),
    tenantIsolation(),
  ],
).enableRLS();
