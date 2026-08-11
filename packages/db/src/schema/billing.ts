import { pgTable, uuid, text, integer, timestamp, index, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { order } from "./order";
import { patient } from "./patient";
import { testDefinition } from "./test-catalog";

// FEAT-046 (ADR-0041): a thin invoice + payment-status edge, never a
// ledger/AR subledger/insurance-adjudication record -- see ADR-0041's own
// Decision section for the full boundary this schema deliberately does not
// cross. Tenant-scoped per ADR-0004 (contrast case): operational,
// tenant-varying billing data, not global reference data.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id),
    // The only ledger-like concept this schema carries -- no running
    // account balance across invoices, no computed/stored AR aging.
    status: text("status").notNull().default("unpaid"),
    totalCents: integer("total_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_invoice_tenant_order").on(table.tenantId, table.orderId),
    check("ck_invoice_status", sql`${table.status} IN ('unpaid','partial','paid')`),
    tenantIsolation(),
  ],
).enableRLS();

export const invoiceLineItem = pgTable(
  "invoice_line_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinition.id),
    // Snapshotted at generation time (engineering/database-design's
    // snapshot-write discipline, same as reference_range/report_template_
    // version) -- never re-read live from test_definition after creation,
    // so a later catalog price change never alters an already-generated
    // invoice.
    billingCode: text("billing_code"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_invoice_line_item_tenant_invoice").on(table.tenantId, table.invoiceId),
    tenantIsolation(),
  ],
).enableRLS();

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    // Scoped to cash/mobile_money for this feature (ADR-0041) -- card/
    // insurance/bank each need their own real provider/adjudication
    // decision this feature doesn't make. Plain text-discriminator, not a
    // Postgres enum (ADR-0006's native-enum precedent is a deliberate,
    // one-off deviation scoped to observation.data_type only) -- adding a
    // method later is a value addition, not a type migration.
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    // An opaque provider-assigned reference (e.g. a mobile-money
    // transaction id) -- never raw payment credentials (KB-36's
    // tokenize-never-store posture).
    providerReference: text("provider_reference"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_payment_tenant_invoice").on(table.tenantId, table.invoiceId),
    check("ck_payment_method", sql`${table.method} IN ('cash','mobile_money')`),
    check("ck_payment_status", sql`${table.status} IN ('pending','succeeded','failed')`),
    tenantIsolation(),
  ],
).enableRLS();
