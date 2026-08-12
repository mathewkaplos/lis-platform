import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { order, orderedTest } from "./order";
import { specimen } from "./specimen";

// Tenant-scoped per ADR-0004 (contrast case): case/block/slide are
// operational, tenant-varying clinical-workflow data, same category as
// order/specimen.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// FEAT-057 (ADR-0049, docs/plans/feat-057-case-specimen-block-slide-hierarchy.md).
// A first-class aggregate above Order/Specimen -- NOT a reuse of either.
// Created at accessioning (same moment/mechanism as specimen.accessionNumber,
// TASK-045's generateAccessionNumber()); one Case per Order (ux_case_tenant_order
// below, proposal §5/§10 Q4 -- a lab needing two independent surgical cases
// creates two orders). status mirrors specimen.status's own plain-text+CHECK
// convention (4 values, well under database-design Skill entry #1's "8+ on a
// central table" ENUM threshold): accessioned -> in_process -> signed_out ->
// amended. `signed_out` here is a schema-only status transition (proposal §5
// scope cut) -- the real step-up-signed sign-out is FEAT-059's job, not this
// feature's.
export const caseTable = pgTable(
  "case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id),
    accessionNumber: text("accession_number").notNull(),
    status: text("status").notNull().default("accessioned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_case_tenant_accession").on(table.tenantId, table.accessionNumber),
    uniqueIndex("ux_case_tenant_order").on(table.tenantId, table.orderId),
    check("ck_case_status", sql`${table.status} IN ('accessioned','in_process','signed_out','amended')`),
    tenantIsolation(),
  ],
).enableRLS();

// ADR-0049 §Decision 2: Block is a new entity, child of Specimen/part,
// independently identified -- no new custody-tracking mechanism (KB-23's
// full append-only custody-event stream is not built anywhere in this repo
// yet, `domain/specimen-lifecycle` Skill entry #6), so status here is a
// minimal active/disposed marker, not a grossing/processing/staining state
// machine (that belongs to the workflow engine in a later M13 feature).
// blockNumber is case-scoped (not part-scoped, proposal §5) via a
// max-plus-one count in the same insert transaction -- accepted as
// low-concurrency-safe (one pathologist grosses one case at a time),
// `engineering/api-design` Skill entry #9's own "human-initiated,
// low-frequency" reasoning for retry-free identifier assignment.
export const block = pgTable(
  "block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    specimenId: uuid("specimen_id")
      .notNull()
      .references(() => specimen.id),
    blockNumber: integer("block_number").notNull(),
    code: text("code").notNull(), // `{case.accessionNumber}-B{n}`, KB-24 hierarchical code
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_block_tenant_code").on(table.tenantId, table.code),
    index("ix_block_specimen").on(table.specimenId),
    check("ck_block_status", sql`${table.status} IN ('active','disposed')`),
    tenantIsolation(),
  ],
).enableRLS();

// ADR-0049 §Decision 2: Slide is a new entity, child of Block, same
// active/disposed-only status reasoning as `block` above. slideNumber is
// block-scoped, same max-plus-one convention.
export const slide = pgTable(
  "slide",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => block.id),
    slideNumber: integer("slide_number").notNull(),
    code: text("code").notNull(), // `{block.code}-S{n}`
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_slide_tenant_code").on(table.tenantId, table.code),
    index("ix_slide_block").on(table.blockId),
    check("ck_slide_status", sql`${table.status} IN ('active','disposed')`),
    tenantIsolation(),
  ],
).enableRLS();

// ADR-0049 §Decision 4: reflex/add-on stains and IHC create new OrderedTests
// on existing blocks, never a new Case or Specimen row. Own tenant_id + RLS
// policy, matching the specimen_fulfillment/panel_test/test_analyte join-table
// precedent (rls-multi-tenancy Skill entry #2) rather than relying on the two
// parent tables' own RLS.
export const blockFulfillment = pgTable(
  "block_fulfillment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => block.id),
    orderedTestId: uuid("ordered_test_id")
      .notNull()
      .references(() => orderedTest.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_block_fulfillment_block_ordered_test").on(table.blockId, table.orderedTestId),
    tenantIsolation(),
  ],
).enableRLS();
