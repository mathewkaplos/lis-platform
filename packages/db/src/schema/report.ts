import { pgTable, uuid, text, timestamp, jsonb, index, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orderedTest } from "./order";

// Tenant-scoped per ADR-0004 (contrast case): a report is operational,
// tenant-varying clinical-workflow data, same category as order/observation.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// TASK-059 (FEAT-016 revision, docs/plans/feat-016-minimal-report.md §10 Q1,
// resolved Option A). Deliberately NOT KB-02's own `Report` aggregate/state
// machine (draft/preliminary/final/amended, ReportTemplate versioning) --
// that is FEAT-032's later, much larger scope (see this revision's finding
// #3). This table records the fact and provenance of one assembly: which
// ordered test, which exact observation versions were included, and the
// resulting content hash -- nothing more.
//
// One report per `ordered_test` (a chemistry panel), not per `order` --
// KB-02's own "Open questions" section names this directly for chemistry
// ("chemistry = per panel"), matching every other precedent in this schema
// (draft/finalize/verify/results-grid are all scoped to ordered_test).
//
// No PDF bytes stored (§10 Q1 Option A, not B) -- no object/blob storage
// exists anywhere in this repo yet (revision finding #5); TASK-060
// re-renders on demand from the same immutable, verified observation rows
// and verifies the hash still matches, leaning on TASK-058's own
// already-proven byte-for-byte determinism.
//
// No uniqueness constraint on orderedTestId: re-assembling the same
// already-verified panel is idempotent (identical hash) and always
// audited as its own real occurrence, mirroring TASK-046's own "every
// print, first or repeat, audited identically, no reprint-tracking table"
// precedent (barcode-printing Skill) rather than inventing a new
// once-only business rule this task's own scope doesn't ask for.
export const report = pgTable(
  "report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderedTestId: uuid("ordered_test_id")
      .notNull()
      .references(() => orderedTest.id),
    contentHash: text("content_hash").notNull(), // sha256 hex, TASK-058's computeReportContentHash
    // [{ id: uuid, createdAt: ISO string }, ...] -- the exact observation
    // versions assembled into this report. jsonb, not a join table with a
    // composite FK to observation's own (id, created_at) PK: nothing in
    // this repo yet needs to query "which reports include observation X",
    // and observation.ts's own header comment already documents how much
    // extra hand-written-SQL machinery a real composite FK costs
    // (MATCH FULL, drizzle-kit can't express it) -- not justified here for
    // a field that is provenance/display data, not an enforced constraint.
    includedObservations: jsonb("included_observations").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedByUserId: uuid("generated_by_user_id").notNull(), // no FK: no user table exists yet (M2), mirrors observation.operatorUserId/verifierUserId
  },
  (table) => [
    index("ix_report_tenant_ordered_test").on(table.tenantId, table.orderedTestId),
    tenantIsolation(),
  ],
).enableRLS();
