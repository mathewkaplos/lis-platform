import { pgTable, uuid, text, timestamp, index, pgPolicy, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { observation } from "./observation";
import { controlLot } from "./control-lot";

// Tenant-scoped per ADR-0004, same pattern as control_lot/observation.
const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  });

// ADR-0018 (FEAT-019, TASK-067): a Westgard rejection/warning detected
// against a QC Observation. Detection-only -- no resolve/acknowledge
// lifecycle here (FEAT-020's own scope, KB-27's "resolution is a documented,
// audited action"). Written in the same transaction as the triggering
// observation.qc_record insert (control-lot.controller.ts's recordResult()),
// never as a standalone write.
export const qcRuleViolation = pgTable(
  "qc_rule_violation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    controlLotId: uuid("control_lot_id")
      .notNull()
      .references(() => controlLot.id),
    observationId: uuid("observation_id").notNull(), // the QC observation that triggered this violation
    // Companion to observationId: observation's PK is composite (id,
    // created_at) post-partitioning (ADR-0008), so a single-column FK is
    // impossible -- same pattern critical_notification.observationCreatedAt
    // and result_history.observationCreatedAt already established
    // (database-design Skill entry #10), applied here directly rather than
    // rediscovered. Always set atomically from the same just-inserted
    // observation row recordResult() already has in hand.
    observationCreatedAt: timestamp("observation_created_at", { withTimezone: true }).notNull(),
    ruleCode: text("rule_code").notNull(), // '1_2s' | '1_3s' | '2_2s' | 'r_4s' | '4_1s' | '10x'
    severity: text("severity").notNull(), // 'warning' | 'rejection'
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_qc_rule_violation_tenant_control_lot").on(table.tenantId, table.controlLotId),
    check(
      "ck_qc_rule_violation_rule_code",
      sql`${table.ruleCode} IN ('1_2s','1_3s','2_2s','r_4s','4_1s','10x')`,
    ),
    check("ck_qc_rule_violation_severity", sql`${table.severity} IN ('warning','rejection')`),
    foreignKey({
      columns: [table.observationId, table.observationCreatedAt],
      foreignColumns: [observation.id, observation.createdAt],
      name: "qc_rule_violation_observation_id_created_at_fk",
    }),
    tenantIsolation(),
  ],
).enableRLS();
