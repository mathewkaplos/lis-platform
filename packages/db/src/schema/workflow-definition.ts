import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, uniqueIndex, pgPolicy, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tenantIsolation = () =>
  pgPolicy("tenant_isolation", {
    using: sql`tenant_id = current_setting('app.tenant_id', true)::uuid`,
  });

// FEAT-029 (ADR-0029): KB-25's own workflow definition model, deliberately
// narrowed -- scoped (tenant) only, not (tenant, discipline) (no event
// payload carries a discipline field yet, ADR-0029's own §Decision). `rules`
// is an array of { id, on, when, do } -- `when` is the fixed JSON-tree shape
// ADR-0029 decided, evaluated by workflow-condition-evaluator.ts, never a
// parsed string. `status` mirrors KB-25's own draft -> in_review ->
// published -> archived lifecycle; only `published` rows are evaluated
// (WorkflowEngineService), and the guardrail validator
// (workflow-definition.service.ts) runs before any row may reach
// `published` -- never bypassable by a direct write, since this is the only
// code path that sets that status.
export const workflowDefinition = pgTable(
  "workflow_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    rules: jsonb("rules").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one published definition per tenant at a time (ADR-0029) --
    // same partial-unique-index shape as instrument_analyte_mapping's own
    // "at most one published mapping" constraint (FEAT-027).
    uniqueIndex("ux_workflow_definition_tenant_published")
      .on(table.tenantId)
      .where(sql`${table.status} = 'published'`),
    check(
      "ck_workflow_definition_status",
      sql`${table.status} IN ('draft','in_review','published','archived')`,
    ),
    tenantIsolation(),
  ],
).enableRLS();

// KB-25's own explicit requirement: "record the rule firing... to the audit
// trail -- every automated action is as traceable as a human one." Recorded
// for every rule evaluated on every consumed event, matched or not --
// `matched: false` rows prove a rule was genuinely considered and didn't
// fire, not silently skipped. `command`/`dispatched` are null/false this
// phase (FEAT-029 ships zero real command handlers, ADR-0029/proposal §5) --
// populated once FEAT-030/031 register real ones.
export const workflowRuleFiring = pgTable(
  "workflow_rule_firing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workflowDefinitionId: uuid("workflow_definition_id").notNull(),
    ruleId: text("rule_id").notNull(),
    eventType: text("event_type").notNull(),
    matched: boolean("matched").notNull(),
    command: text("command"),
    dispatched: boolean("dispatched"), // null when matched=false (no command attempted)
    // FEAT-031 (ADR-0031): true when the firing rule's own dryRun:true --
    // the handler still ran (dispatched can be true) but was told to skip
    // any real write. Lets a review query distinguish "would have qualified"
    // firings from live ones without guessing from dispatched alone.
    dryRun: boolean("dry_run").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolation()],
).enableRLS();
