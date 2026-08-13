import { pgTable, uuid, text, date, timestamp, index, uniqueIndex, pgPolicy, check, type AnyPgColumn } from "drizzle-orm/pg-core";
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

    // FEAT-065 (ADR-0052, docs/plans/feat-065-patient-merge.md). Set only on
    // the merged-away (loser) row, pointing at the surviving patient --
    // never deleted, never any other column altered (KB-02's own "never
    // destroy source identity"). Same "old row stays, pointer moves
    // forward" shape as observation.superseded_by (ADR-0007) and
    // caseReportVersion.supersededBy (ADR-0051), applied to patient for the
    // first time. A merge into/of an already-merged-away row is rejected by
    // the API, not resolved here -- no chain-walking is ever needed.
    mergedInto: uuid("merged_into").references((): AnyPgColumn => patient.id),

    // FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md):
    // real design-partner field set (Eldoret Pathology Diagnostics
    // screenshots), blended into the KB-02-minimal core. All nullable --
    // none is required by any existing invariant, matching birthDate's own
    // "null = unknown, never a sentinel" convention rather than inventing
    // a NOT NULL requirement the evidence doesn't show.
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    nextOfKinName: text("next_of_kin_name"),
    nextOfKinPhone: text("next_of_kin_phone"),

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
    index("ix_patient_merged_into").on(table.mergedInto),
    check("ck_patient_sex", sql`${table.sex} IN ('M','F','U')`),
    check("ck_patient_merged_into_not_self", sql`${table.mergedInto} IS NULL OR ${table.mergedInto} != ${table.id}`),
    tenantIsolation(),
  ],
).enableRLS();
