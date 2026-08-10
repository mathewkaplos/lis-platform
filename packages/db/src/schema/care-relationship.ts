import { pgTable, uuid, text, timestamp, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { patient } from "./patient";

// Tenant-scoped per ADR-0004/Constitution Law #4, same pattern as every
// other tenant-scoped table -- RLS from this table's own first migration,
// not a follow-up.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

/**
 * FEAT-040 (docs/plans/feat-040-fine-grained-abac-relationship-authz.md,
 * ADR-0011's own anticipated resolution): a clinician-patient relationship,
 * modeled in Postgres rather than as a Keycloak user attribute -- it needs
 * to be joined against `patient` in ordinary SQL, exactly the case ADR-0011
 * named as the natural fit for a relational store over a token attribute.
 *
 * `clinicianUserId` is the raw Keycloak `sub` (text), not a foreign key --
 * no `user` table exists anywhere in this codebase yet (the same gap
 * `report-assembly.ts` already flags for `verifierUserId`/
 * `generatedByUserId`).
 *
 * Patient-only for now (proposal §10 Q3, resolved) -- no order/observation-
 * level relationship shape is built ahead of FEAT-038 actually needing one.
 *
 * No HTTP endpoint creates a row here in this task (proposal §10 Q4,
 * resolved) -- rows are inserted directly via `@lis/db`, same precedent
 * `observation.e2e-spec.ts`'s own synthetic fixtures already established
 * for "no admin endpoint exists yet."
 */
export const careRelationship = pgTable(
  "care_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    clinicianUserId: text("clinician_user_id").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_care_relationship_tenant_clinician_patient").on(
      table.tenantId,
      table.clinicianUserId,
      table.patientId,
    ),
    tenantIsolation(),
  ],
).enableRLS();
