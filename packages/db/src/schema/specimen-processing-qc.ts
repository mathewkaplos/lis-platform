import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseTable } from "./anatomic-pathology";

// Tenant-scoped per ADR-0004 (contrast case): a QC batch review is
// operational, tenant-varying clinical-workflow data, same category as
// case/block/slide.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md).
// Transcribed directly from the design partner's own real, currently-used
// paper form (`TRACKING SHEET (1).docx`, "IQC for tissue processing,
// microtomy, H/E staining & tracking sheet") -- v1 scope is deliberately
// AP-specific, not a generic cross-discipline QC engine (proposal §10 Q1),
// since that's the only real evidenced document; generalize only once a
// second discipline's own real form surfaces, matching ADR-0050's own
// "generalize only after real evidence" precedent for the synoptic-protocol
// engine.
//
// One evaluation applies to a whole batch (one grossing pathologist, one
// histotech, one grossing date), covering potentially many accessioned
// cases -- see `specimenProcessingBatchCase` below for the per-case rows.
// Each of the seven criteria is the exact two-named-state judgment the real
// form uses, CHECK-constrained plain text (domain/specimen-lifecycle Skill
// entry #5's own "fixed coded value set, not free text or a boolean"
// precedent) -- a boolean would lose which named state was meant, e.g.
// "processing: optimal" vs. "Suboptimal" isn't really "true/false processing".
//
// `grossingPathologistUserId` carries no FK (no `user` table exists in this
// schema, matching `caseReportVersion.signedByUserId`'s own convention) --
// resolved server-side from the submitting user's own JWT `sub` claim, never
// a form field. `histoTechName` is a plain text field (proposal §10 Q2): no
// histotech role/roster exists in this system yet, and inventing one ahead
// of real need is out of this feature's scope.
export const specimenProcessingBatch = pgTable(
  "specimen_processing_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    grossingPathologistUserId: uuid("grossing_pathologist_user_id").notNull(),
    histoTechName: text("histo_tech_name").notNull(),
    grossingDate: timestamp("grossing_date", { withTimezone: true }).notNull(),
    slidesForwardedDate: timestamp("slides_forwarded_date", { withTimezone: true }).notNull(),
    tissueFixation: text("tissue_fixation").notNull(),
    processing: text("processing").notNull(),
    sectionThickness: text("section_thickness").notNull(),
    tissueFoldsTears: text("tissue_folds_tears").notNull(),
    stainingQuality: text("staining_quality").notNull(),
    coverslipping: text("coverslipping").notNull(),
    tissueOrientation: text("tissue_orientation").notNull(),
    comments: text("comments"),
    correctiveAction: text("corrective_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_specimen_processing_batch_tenant_created").on(table.tenantId, table.createdAt),
    check("ck_specimen_processing_batch_tissue_fixation", sql`${table.tissueFixation} IN ('adequate','inadequate')`),
    check("ck_specimen_processing_batch_processing", sql`${table.processing} IN ('optimal','suboptimal')`),
    check("ck_specimen_processing_batch_section_thickness", sql`${table.sectionThickness} IN ('acceptable','unacceptable')`),
    check("ck_specimen_processing_batch_tissue_folds_tears", sql`${table.tissueFoldsTears} IN ('present','absent')`),
    check("ck_specimen_processing_batch_staining_quality", sql`${table.stainingQuality} IN ('acceptable','unacceptable')`),
    check("ck_specimen_processing_batch_coverslipping", sql`${table.coverslipping} IN ('artefacts','no_artefacts')`),
    check("ck_specimen_processing_batch_tissue_orientation", sql`${table.tissueOrientation} IN ('satisfactory','unsatisfactory')`),
    tenantIsolation(),
  ],
).enableRLS();

// The manifest table's own per-row shape (`Lab No.` / `No. of Slides` /
// `Doctor's Remarks`) -- `caseId` is the real accessioned Case this row's
// `Lab No.` refers to (proposal §5 item 2: AP's own top-level accessioned
// entity, ADR-0049), not `specimen.accessionNumber`. Own tenant_id + RLS
// policy per engineering/rls-multi-tenancy Skill entry #2 (a join table
// needs its own policy, not a reliance on its parents'), matching
// `block_fulfillment`'s own precedent in anatomic-pathology.ts.
export const specimenProcessingBatchCase = pgTable(
  "specimen_processing_batch_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => specimenProcessingBatch.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => caseTable.id),
    slideCount: integer("slide_count").notNull(),
    pathologistRemarks: text("pathologist_remarks"),
  },
  (table) => [
    uniqueIndex("ux_specimen_processing_batch_case_batch_case").on(table.batchId, table.caseId),
    index("ix_specimen_processing_batch_case_batch").on(table.batchId),
    index("ix_specimen_processing_batch_case_case").on(table.caseId),
    tenantIsolation(),
  ],
).enableRLS();
