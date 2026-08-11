import { pgTable, pgEnum, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// Global registry table -- no tenant_id, no RLS. Necessarily exempt: this
// table defines the tenants RLS scopes BY, so it cannot itself be scoped by
// the tenant_id it is the source of. Reasoning recorded in ADR-0039 (this
// feature) and the exemption convention in ADR-0038, mirroring ADR-0004's
// precedent for analyte/unit/code_system_value.

export const tenantIsolationTier = pgEnum("tenant_isolation_tier", [
  "shared",
  "dedicated_schema",
  "dedicated_db",
]);

export const tenant = pgTable("tenant", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isolationTier: tenantIsolationTier("isolation_tier").notNull().default("shared"),
  // Set only when isolationTier = 'dedicated_schema'.
  schemaName: text("schema_name"),
  // A config KEY naming a connection string held in environment/secrets
  // config -- never a raw connection string stored in this table. Set only
  // when isolationTier = 'dedicated_db'. ADR-0039: no code path resolves
  // this yet -- dedicated_db is a real, storable enum value with no working
  // runtime routing in this feature (see tenant-resolver.ts); assigning a
  // tenant to it today is a data-entry no-op, not a working isolation
  // guarantee.
  connectionRef: text("connection_ref"),
  region: text("region"),
  // FEAT-056 (ADR-0048 decision 2): explicit per-tenant opt-in required
  // before this tenant's own data is ever aggregated into a cross-tenant
  // AMR surveillance report. Default false -- no tenant is aggregated
  // without having explicitly agreed to it. One flag on this table's own
  // existing global registry row, not a new table (the smallest schema
  // addition that satisfies the requirement).
  amrSurveillanceOptIn: boolean("amr_surveillance_opt_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
