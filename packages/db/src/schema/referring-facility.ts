import { pgTable, uuid, text, timestamp, index, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant-scoped per ADR-0004: each tenant has its own real set of referring
// partners, operational data -- not global reference data like
// test_definition.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md):
// one row per external partner facility, reused for two roles -- order
// attribution (order.referringFacilityId, "who sent this patient in") and
// invoice payer (invoice.referringFacilityId, "who this is billed to" when
// invoice.payerType = 'corporate'). Real design-partner evidence
// (Eldoret Pathology Diagnostics screenshots) shows the same named
// organizations serving both roles -- deliberately not split into two
// overlapping tables, see ADR-0053's own Decision section.
export const referringFacility = pgTable(
  "referring_facility",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_referring_facility_tenant_name").on(table.tenantId, table.name),
    tenantIsolation(),
  ],
).enableRLS();
