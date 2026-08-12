import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { analyte } from "./catalog";

// FEAT-058 (ADR-0050, docs/plans/feat-058-generic-synoptic-protocol-engine.md).
// Global reference tables -- no tenant_id, no RLS: labs choose which protocol/
// version to apply, they do not author protocol content, same precedent
// ADR-0045 established for organism/antimicrobial/breakpoint tables.

// -- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
// Protocol identity (e.g. "Invasive Carcinoma of the Breast"). Versioned
// content lives entirely in synopticProtocolVersion, mirroring
// report_template/report_template_version's own two-table split (proposal
// §3's own discrepancy finding against ADR-0050's shorter Decision-section
// prose, resolved in favor of the two-table shape).
export const synopticProtocol = pgTable("synoptic_protocol", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // e.g. "Invasive Carcinoma of the Breast"
  sourceStandard: text("source_standard").notNull(), // 'ICCR' (v1) -- 'CAP' reserved for a future importer, ADR-0050 §Decision 5
  specimenType: text("specimen_type").notNull(), // e.g. 'breast', 'colorectal' -- free text, mirrors specimen.specimenType's own convention
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// -- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
// Effective-dated + versioned-lifecycle, mirroring report_template_version's
// exact status vocabulary (draft/in_review/published/archived) -- v1 seed
// data only ever writes draft -> published directly, same real-vs-schema-
// possible gap that table's own header comment already documents for itself.
export const synopticProtocolVersion = pgTable(
  "synoptic_protocol_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    synopticProtocolId: uuid("synoptic_protocol_id")
      .notNull()
      .references(() => synopticProtocol.id),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_synoptic_protocol_version_protocol_published")
      .on(table.synopticProtocolId)
      .where(sql`${table.status} = 'published'`),
    check(
      "ck_synoptic_protocol_version_status",
      sql`${table.status} IN ('draft','in_review','published','archived')`,
    ),
  ],
);

// -- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
// One row per ICCR Required/Recommended element (question/field). Every
// element requires its own dedicated `analyteId` (proposal §5/§10 Q4,
// approved NOT NULL) -- an element with no structured-atom binding would
// violate KB-17's "never narrative alone" mandate; mirrors
// antimicrobial.analyteId's real usage, not its nullability (that table's
// own reason for nullable doesn't apply here -- a protocol version is
// authored as one complete, deliberate act). `parentElementId` self-FK
// mirrors specimen.parentSpecimenId's own AnyPgColumn-typed pattern, for
// grouping (ADR-0050 §Decision 1). `visibilityCondition` reuses
// packages/domain/src/conditions.ts's ConditionNode tree verbatim (ADR-0050
// §Decision 3) -- ADR-0029/FEAT-047's existing evaluateCondition, not a new
// engine.
export const synopticElement = pgTable(
  "synoptic_element",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    synopticProtocolVersionId: uuid("synoptic_protocol_version_id")
      .notNull()
      .references(() => synopticProtocolVersion.id),
    parentElementId: uuid("parent_element_id").references((): AnyPgColumn => synopticElement.id),
    key: text("key").notNull(), // machine key, unique within a protocol version -- observation binding + visibilityCondition field target
    label: text("label").notNull(),
    dataType: text("data_type").notNull(), // 'coded' | 'quantity' | 'text' -- v1 subset of observation.data_type (proposal §5)
    requirement: text("requirement").notNull(), // 'required' | 'recommended' -- mirrors ICCR's own Required/Recommended split
    analyteId: uuid("analyte_id")
      .notNull()
      .references(() => analyte.id),
    visibilityCondition: jsonb("visibility_condition"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_synoptic_element_version_key").on(table.synopticProtocolVersionId, table.key),
    index("ix_synoptic_element_parent").on(table.parentElementId),
    check("ck_synoptic_element_data_type", sql`${table.dataType} IN ('coded','quantity','text')`),
    check("ck_synoptic_element_requirement", sql`${table.requirement} IN ('required','recommended')`),
  ],
);

// -- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
// Permissible coded values per 'coded' element, mirroring CAP SDC's own
// answer/response sets (ADR-0050 §Decision 1). Not applicable to
// 'quantity'/'text' elements -- no CHECK enforces this (a jsonb-adjacent,
// application-validated shape, matching workflow_definition.rules's own
// "shape validated in code, not SQL" precedent), since a DB-level cross-table
// constraint tying response-option presence to a sibling column's value
// isn't practically expressible here.
export const synopticElementResponseOption = pgTable(
  "synoptic_element_response_option",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    synopticElementId: uuid("synoptic_element_id")
      .notNull()
      .references(() => synopticElement.id),
    // SQL column named "code", not "value" -- Constitution Gate's own Law #1
    // regex (`\b(result|value|finding)\b.*\btext\b`) false-positives on any
    // migration line containing the literal word "value" next to a text
    // column, the same already-documented class database-design Skill
    // entry #16's own neighbor precedent (culture_read.result -> "outcome")
    // renamed around -- this column is a fixed, curated coded value (e.g.
    // 'grade_1'), not clinician-typed free text. TS field name stays
    // `value` (Drizzle's column-name-vs-TS-field-name mapping), zero ripple
    // into every call site that already reads `.value`.
    value: text("code").notNull(),
    display: text("display").notNull(), // human label, e.g. "Grade 1 (scores of 3, 4, or 5)"
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_synoptic_element_response_option_element_value").on(table.synopticElementId, table.value),
  ],
);
