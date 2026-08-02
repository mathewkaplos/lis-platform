import { pgTable, uuid, text, boolean, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { patient } from "./patient";

// Tenant-scoped per ADR-0004 (contrast case), and its own tenant_id + RLS
// policy per rls-multi-tenancy Skill entry #2 (join/link-adjacent tables
// don't inherit isolation from their parent — every tenant-scoped table
// needs its own).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// TASK-038's own title ("patient + identifiers + alerts"). Google Stitch
// Prompt Library §4.6 "Patient Alerts" is the only place in the research
// corpus that defines what "alerts" means here: four types, severity-coded,
// with description/added-by/date/expiry/deactivate (FEAT-011 proposal §3).
//
// added_by_principal_id follows audit_event.actor_principal_id's existing
// convention (packages/db/src/schema/audit.ts): a plain uuid, no FK — no
// local user table exists anywhere in this repo, identity is Keycloak's
// `sub` claim. Creating/deactivating an alert is a clinically significant
// action (Constitution Law #5) audited via the existing audit_event writer
// at the API layer (TASK-039+) — not this migration's own scope.
export const patientAlert = pgTable(
  "patient_alert",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id),

    alertType: text("alert_type").notNull(), // allergy | medical_alert | infection_control | vip_confidential
    severity: text("severity").notNull(), // low | medium | high | critical
    description: text("description").notNull(),

    addedByPrincipalId: uuid("added_by_principal_id").notNull(),
    active: boolean("active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_patient_alert_tenant_patient").on(table.tenantId, table.patientId),
    check("ck_patient_alert_alert_type", sql`${table.alertType} IN ('allergy','medical_alert','infection_control','vip_confidential')`),
    check("ck_patient_alert_severity", sql`${table.severity} IN ('low','medium','high','critical')`),
    tenantIsolation(),
  ],
).enableRLS();
