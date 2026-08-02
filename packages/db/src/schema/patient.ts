import { pgTable, uuid, text, date, timestamp, index, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant-scoped per ADR-0004 (contrast case): patients are operational,
// tenant-varying clinical-workflow data.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-02 Patient aggregate, KB-02-minimal scope only (FEAT-011 proposal §10 Q1,
// docs/plans/feat-011-patient-management.md): identity, demographics required
// for reference-range resolution, and the two identifiers TASK-038's own AC
// requires. Contact/insurance/emergency-contact/photo/blood-group fields are
// deliberately deferred to a follow-up migration once TASK-040's real
// registration-form requirements are known, not built speculatively now.
//
// sex/birth_date implement KB-02's literal invariant: "Sex and birth date are
// required (or explicitly 'unknown', which affects range resolution)." sex is
// NOT NULL with an explicit 'U' (unknown) value — matching
// reference_range.sex's existing 'M'|'F' text-discriminator convention
// (database-design Skill entry #1), extended with 'U' rather than using NULL,
// since the invariant requires a value to always be present. birth_date is a
// nullable date, NULL meaning unknown — no sentinel date is invented.
export const patient = pgTable(
  "patient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),

    mrn: text("mrn").notNull(), // system-issued, always assignable at registration
    nationalId: text("national_id"), // nullable: not every real patient has one (minors, foreign nationals, emergency admissions)

    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    sex: text("sex").notNull(), // 'M' | 'F' | 'U' (explicit unknown, see header comment)
    birthDate: date("birth_date", { mode: "date" }), // null = unknown, per KB-02

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_patient_tenant_mrn").on(table.tenantId, table.mrn),
    // Partial unique index (FEAT-011 proposal §6): allows multiple NULLs per
    // tenant (real patients without a national ID) while still rejecting a
    // true duplicate when one is present.
    uniqueIndex("ux_patient_tenant_national_id")
      .on(table.tenantId, table.nationalId)
      .where(sql`${table.nationalId} IS NOT NULL`),
    index("ix_patient_tenant_name").on(table.tenantId, table.lastName, table.firstName),
    check("ck_patient_sex", sql`${table.sex} IN ('M','F','U')`),
    tenantIsolation(),
  ],
).enableRLS();
