import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { analyte, codeSystemValue } from "./catalog";

// Global reference tables -- no tenant_id, no RLS, per ADR-0045 (extending
// ADR-0004's own precedent for analyte/unit/code_system_value): organism/
// antimicrobial taxonomies and published breakpoint standards are identical
// across every tenant, unlike reference_range's own lab-validated values.

// Mirrors analyte/unit's exact shape (catalog.ts) -- a discipline-specific
// concept referencing the shared code_system_value coding lookup, not a
// bare code_system_value row reused directly (the same reasoning that
// table's own file already establishes for analyte/unit).
export const organism = pgTable("organism", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeSystemValueId: uuid("code_system_value_id")
    .notNull()
    .references(() => codeSystemValue.id)
    .unique(),
  display: text("display").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// FEAT-053: `analyteId` added -- anticipated by FEAT-051's own proposal
// (§5: "antimicrobials will each need their own discipline-specific
// attributes later"), a real usage rather than a speculative one now:
// each antimicrobial's own S/I/R result is a discrete coded Observation
// against its own dedicated analyte (KB-21's dual-emission antibiogram),
// so the query "all carbapenem-resistant E. coli this quarter"
// (FEAT-053's own literal AC) is a normal `observation.analyteId` join,
// the same mechanism every other discipline already uses. Nullable --
// not every antimicrobial in the catalog necessarily has a seeded
// susceptibility-result analyte yet (FEAT-053 proposal §5's own real
// LOINC-per-antimicrobial seeding is scoped to whatever antimicrobials
// FEAT-051's real breakpoint data actually covers, not invented ahead of
// need).
export const antimicrobial = pgTable("antimicrobial", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeSystemValueId: uuid("code_system_value_id")
    .notNull()
    .references(() => codeSystemValue.id)
    .unique(),
  display: text("display").notNull(),
  analyteId: uuid("analyte_id").references(() => analyte.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A named, published breakpoint standard (e.g. "EUCAST v16.0"), versioned
// and effective-dated the same way reference_range already is (KB-15's own
// snapshot discipline) -- but global, not tenant-scoped (ADR-0045): the
// underlying values are a published standard, not a lab-local validation.
// sourceUrl is a real citation, required -- this table exists specifically
// so a breakpoint's own provenance is never a guess (proposal §10 Q3).
export const breakpointTable = pgTable("breakpoint_table", {
  id: uuid("id").primaryKey().defaultRandom(),
  publisher: text("publisher").notNull(), // 'EUCAST' | 'CLSI'
  version: text("version").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  sourceUrl: text("source_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// v1 scope (proposal §5, approved): MIC-based interpretation only, single-
// organism keying (no organism-group generalization), S/I/R only -- no
// disk-diffusion zone-diameter breakpoints, no EUCAST ATU modeled
// separately (folded into the resistant threshold; a real, later
// refinement, not modeled here -- see db/seed/microbiology-catalog.sql's
// own header comment for the real EUCAST ATU finding this narrowing is
// responding to). `method` is plain text, not a Postgres ENUM (mirrors
// reference_range.method's own precedent -- adding a new method later is a
// data change, not a migration, `engineering/database-design` Skill entry
// #1).
export const breakpoint = pgTable(
  "breakpoint",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    breakpointTableId: uuid("breakpoint_table_id")
      .notNull()
      .references(() => breakpointTable.id),
    organismId: uuid("organism_id")
      .notNull()
      .references(() => organism.id),
    antimicrobialId: uuid("antimicrobial_id")
      .notNull()
      .references(() => antimicrobial.id),
    method: text("method").notNull(), // 'MIC' (v1 scope -- see header comment)
    susceptibleMax: numeric("susceptible_max").notNull(), // S≤ threshold, mg/L
    resistantMin: numeric("resistant_min").notNull(), // R> threshold, mg/L
    sourceNote: text("source_note"), // e.g. "indications other than meningitis, EUCAST v16.0 p.15"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_breakpoint_organism_antimicrobial").on(table.organismId, table.antimicrobialId),
    index("ix_breakpoint_table").on(table.breakpointTableId),
  ],
);
