import { pgTable, uuid, text, timestamp, uniqueIndex, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { patient } from "./patient";

const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

/**
 * FEAT-039 (docs/plans/feat-039-patient-portal.md, engineering/authz's own
 * ADR-0011 "attribute lives in Postgres" precedent, already applied once by
 * FEAT-040's `care_relationship`): links a Keycloak `sub` to exactly one
 * `patient` row -- 1:1 for v1, proxy/guardian access (many patients per
 * account, or many accounts per patient) is a real, deliberately deferred
 * KB-32 "Future consideration," not built speculatively here.
 *
 * `patientUserId` is the raw Keycloak `sub` (text), same convention
 * `care_relationship.clinicianUserId` already established -- no `user`
 * table exists anywhere in this codebase.
 *
 * No HTTP endpoint creates a row here in this task (proposal §5) -- rows
 * are inserted directly via `@lis/db` in tests, same precedent
 * `care_relationship`'s own no-assignment-endpoint decision already set.
 */
export const patientPortalAccount = pgTable(
  "patient_portal_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    patientUserId: text("patient_user_id").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1:1 both directions (proposal §5): one portal account per patient,
    // one patient per portal account.
    uniqueIndex("ux_patient_portal_account_tenant_user").on(table.tenantId, table.patientUserId),
    uniqueIndex("ux_patient_portal_account_tenant_patient").on(table.tenantId, table.patientId),
    tenantIsolation(),
  ],
).enableRLS();
