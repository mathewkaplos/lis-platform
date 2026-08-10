import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { testDefinition } from "./test-catalog";

// 1-arg current_setting() (throws if app.tenant_id was never set), matching
// the majority convention (report.ts/test-catalog.ts among them) -- not
// outbox_event.ts/critical_notification.ts's own 2-arg missing_ok=true
// form, which those two tables need specifically because `lis_scheduler`
// (a real, second, cross-tenant role) reads them without ever setting
// app.tenant_id. No second role reads report_template/report_template_version;
// every access goes through TenantContextInterceptor, which always sets it
// first -- so the throwing form's "fail loud, not silently return zero
// rows" behavior is the right default here (database-design Skill entry #1:
// state explicitly why, don't just copy the nearest file).
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md
// findings #1/#5). One `report_template` row per (tenant, test_definition) --
// the named template "slot" for a test, matching AC #1's own "a new test
// with its own report layout" framing (one layout per test, versioned over
// time under it). The versioned metadata tree itself lives entirely in
// `report_template_version.definition` (jsonb), the same "condition/action
// model lives in one jsonb column, not split across rule and catalog"
// precedent `workflow_definition.rules` already established
// (`engineering/workflow-engine` Skill entry #1) -- generalized here to
// "template definition lives in one jsonb column."
export const reportTemplate = pgTable(
  "report_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinition.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_report_template_tenant_test_definition").on(
      table.tenantId,
      table.testDefinitionId,
    ),
    tenantIsolation(),
  ],
).enableRLS();

// Mirrors `workflow_definition`'s exact versioned-lifecycle shape (finding
// #5): `status` allows draft -> in_review -> published -> archived (the
// same CHECK vocabulary), but -- matching that table's own real precedent --
// only `draft` and `published` are actually set by any code path in this
// proposal's scope; `in_review` is schema-ready for a future approval-gate
// feature, not built now.
//
// `definition` (jsonb): { sections: [{ title, fields: [FieldDefinition] }] }.
// FieldDefinition = { key, label, type, analyteBinding?, unit?,
// visibilityCondition? } -- `type` restricted at the application layer
// (report-template-types.ts) to the 5 field types this proposal's own
// finding #4 scoped to (numeric, coded, richText, table,
// referenceRangeDisplay), not enforced by a DB CHECK (matching
// `workflow_definition.rules`'s own "shape validated in code, not SQL"
// precedent -- a jsonb tree isn't a natural CHECK target).
export const reportTemplateVersion = pgTable(
  "report_template_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    reportTemplateId: uuid("report_template_id")
      .notNull()
      .references(() => reportTemplate.id),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one published version per report_template -- transitively, at
    // most one published version per (tenant, test_definition), since
    // report_template itself is unique on that pair. Same partial-unique-
    // index shape as `ux_workflow_definition_tenant_published`.
    uniqueIndex("ux_report_template_version_template_published")
      .on(table.reportTemplateId)
      .where(sql`${table.status} = 'published'`),
    check(
      "ck_report_template_version_status",
      sql`${table.status} IN ('draft','in_review','published','archived')`,
    ),
    tenantIsolation(),
  ],
).enableRLS();
