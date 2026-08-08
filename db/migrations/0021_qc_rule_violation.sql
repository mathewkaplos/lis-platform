-- TASK-067 (FEAT-019, docs/plans/feat-019-levey-jennings-westgard-engine.md):
-- qc_rule_violation table, per ADR-0018 (accepted). drizzle-kit generated
-- output, unmodified except for this header and the file/tag rename (see
-- packages/db/src/schema/qc-rule-violation.ts for the full design
-- rationale). observation_id/observation_created_at is a composite FK, not
-- a plain single-column one, per ADR-0008's addendum (observation's PK is
-- composite post-partitioning) -- same pattern critical_notification and
-- result_history already established (database-design Skill entry #10).
CREATE TABLE "qc_rule_violation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"control_lot_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_created_at" timestamp with time zone NOT NULL,
	"rule_code" text NOT NULL,
	"severity" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_qc_rule_violation_rule_code" CHECK ("qc_rule_violation"."rule_code" IN ('1_2s','1_3s','2_2s','r_4s','4_1s','10x')),
	CONSTRAINT "ck_qc_rule_violation_severity" CHECK ("qc_rule_violation"."severity" IN ('warning','rejection'))
);
--> statement-breakpoint
ALTER TABLE "qc_rule_violation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qc_rule_violation" ADD CONSTRAINT "qc_rule_violation_control_lot_id_control_lot_id_fk" FOREIGN KEY ("control_lot_id") REFERENCES "public"."control_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_rule_violation" ADD CONSTRAINT "qc_rule_violation_observation_id_created_at_fk" FOREIGN KEY ("observation_id","observation_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_qc_rule_violation_tenant_control_lot" ON "qc_rule_violation" USING btree ("tenant_id","control_lot_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qc_rule_violation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);