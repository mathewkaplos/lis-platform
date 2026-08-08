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
// against a QC Observation. Detection-only originally -- TASK-070 (ADR-0019
// Decision 3) adds the resolve lifecycle KB-27's "resolution is a
// documented, audited action" always intended: resolvedAt/resolvedByUserId,
// mirroring critical_notification's own acknowledgedAt/acknowledgedByUserId
// precedent (ADR-0016). "Unresolved" (the gate's own query,
// finalization-rollup.interceptor.ts) means resolvedAt IS NULL. Written in
// the same transaction as the triggering observation.qc_record insert
// (control-lot.controller.ts's recordResult()), never as a standalone write.
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
    // TASK-070: nullable, resolvedAt IS NULL means "still holding release"
    // (ADR-0019 Decision 3). No FK on resolvedByUserId -- matches this
    // table's/observation's own no-FK-on-user-columns convention (no user
    // table exists in Postgres, identity lives in Keycloak, ADR-0011).
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id"),
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
