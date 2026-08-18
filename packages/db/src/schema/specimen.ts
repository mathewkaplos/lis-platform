import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, pgPolicy, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orderedTest } from "./order";
import { caseTable } from "./anatomic-pathology";

// Tenant-scoped per ADR-0004 (contrast case): specimens are operational,
// tenant-varying clinical-workflow data.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// KB-22 Sample Management. Lifecycle state machine (collected -> received ->
// accessioned -> in_process -> completed -> archived/disposed, with
// rejected(reason) reachable from receipt); rejection reason is coded, never
// free text, per Constitution Law #1 (CHECK-constrained text, matching this
// repo's established discriminator convention — FEAT-006 proposal §10 Q2,
// not a shared catalog table or a second native ENUM); parent-linked aliquot
// lineage. Status/lineage updates are plain UPDATEs, not append-only:
// Constitution Law #2 governs verified clinical *results* (observation), not
// specimen workflow state (FEAT-006 proposal §5).
export const specimen = pgTable(
  "specimen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    accessionNumber: text("accession_number").notNull(),
    specimenType: text("specimen_type").notNull(),
    parentSpecimenId: uuid("parent_specimen_id").references((): AnyPgColumn => specimen.id), // aliquot lineage
    // FEAT-057 (ADR-0049 §Decision 1): nullable -- only anatomic-pathology
    // specimens/parts belong to a Case; every other discipline's specimen
    // rows leave this null. Added alongside specimen's real existing
    // OrderedTest link (the specimen_fulfillment join table below) -- ADR-0049's
    // own prose says "alongside orderId/orderedTestId", but no such columns
    // exist on this table; see docs/plans/feat-057-...md §3 for that
    // discrepancy note.
    caseId: uuid("case_id").references(() => caseTable.id),
    status: text("status").notNull().default("collected"),
    rejectionReason: text("rejection_reason"), // set only when status = 'rejected'
    collectionContext: jsonb("collection_context"), // fasting/tourniquet-time/etc — KB-06's JSONB carve-out, not a clinical value
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    // TASK-440 (issue #440, KB-25 reflex/cascade sub-engine): caller-supplied
    // only -- no specimenType-keyed stability-window catalog exists to
    // auto-derive this from (domain/specimen-lifecycle Skill entry #4,
    // specimenType is uncontrolled free text). Null means "not tracked",
    // identical to today's behavior (AddReflexTest always links directly).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_specimen_tenant_accession").on(table.tenantId, table.accessionNumber),
    index("ix_specimen_parent").on(table.parentSpecimenId),
    index("ix_specimen_case").on(table.caseId),
    check(
      "ck_specimen_status",
      sql`${table.status} IN ('collected','received','accessioned','in_process','completed','archived','disposed','rejected')`,
    ),
    check(
      "ck_specimen_rejection_reason",
      sql`${table.rejectionReason} IS NULL OR ${table.rejectionReason} IN ('haemolysed','clotted','insufficient_volume','mislabelled','wrong_container','improper_temperature','expired')`,
    ),
    tenantIsolation(),
  ],
).enableRLS();

// KB-22: specimen<->ordered_test is many-to-many ("fulfilment links" — one
// tube commonly serves several tests; some tests need several tubes). Own
// tenant_id + RLS policy, matching the panel_test/test_analyte join-table
// precedent (TASK-017) rather than relying on the parent tables' RLS.
export const specimenFulfillment = pgTable(
  "specimen_fulfillment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    specimenId: uuid("specimen_id")
      .notNull()
      .references(() => specimen.id),
    orderedTestId: uuid("ordered_test_id")
      .notNull()
      .references(() => orderedTest.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_specimen_fulfillment_specimen_ordered_test").on(table.specimenId, table.orderedTestId),
    tenantIsolation(),
  ],
).enableRLS();
