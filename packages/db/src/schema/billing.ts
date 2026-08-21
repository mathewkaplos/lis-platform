import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { order } from "./order";
import { patient } from "./patient";
import { testDefinition } from "./test-catalog";
import { referringFacility } from "./referring-facility";

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
    // Issue #715: human-readable invoice number, same "cosmetic prefix +
    // global sequence" shape as `accession.ts`'s own generateAccessionNumber
    // -- `INV-YYMMDD-NNNNNN`, e.g. `INV-260821-000123`. Nullable at the
    // schema level only because pre-existing rows (created before this
    // column existed) have none; every invoice created after this migration
    // always gets one (billing.service.ts's own generateInvoice()).
    invoiceNumber: text("invoice_number"),
    // The only ledger-like concept this schema carries -- no running
    // account balance across invoices, no computed/stored AR aging.
    status: text("status").notNull().default("unpaid"),
    totalCents: integer("total_cents").notNull(),
    // FEAT-066 (ADR-0053): the literal follow-up ADR-0041's own
    // Consequences section named ("multi-payer (insurance) support... real,
    // tracked gap"). Stays a thin categorical tag, not a new ledger --
    // 'corporate' means billed to referringFacilityId instead of the
    // patient directly; referringFacilityId is independently nullable and
    // only application-layer-required when payerType = 'corporate' (no
    // DB-level cross-column dependency, matching invoice.status's own
    // plain-CHECK precedent).
    payerType: text("payer_type").notNull().default("cash"),
    referringFacilityId: uuid("referring_facility_id").references(() => referringFacility.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_invoice_tenant_order").on(table.tenantId, table.orderId),
    index("ix_invoice_referring_facility").on(table.referringFacilityId),
    // NULLs aren't considered equal by a Postgres unique index, so
    // pre-existing rows with no invoiceNumber (created before this column
    // existed) never collide with each other or with real values.
    uniqueIndex("ux_invoice_tenant_invoice_number").on(table.tenantId, table.invoiceNumber),
    check("ck_invoice_status", sql`${table.status} IN ('unpaid','partial','paid')`),
    check("ck_invoice_payer_type", sql`${table.payerType} IN ('cash','corporate')`),
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
