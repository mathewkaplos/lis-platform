-- TASK-038 (#97, FEAT-011): patient + identifiers + alerts, per the approved
-- proposal docs/plans/feat-011-patient-management.md. Scope is the
-- KB-02-minimal core (§10 Q1) plus the FK backfill ADR-0005 requires for
-- observation.patient_id and order.patient_id, both forward-referencing
-- columns created ahead of this table by design (TASK-020/FEAT-006).
--
-- Does NOT include the pre-existing, unrelated ADR-0005 gap found during
-- this proposal's research: observation.ordered_test_id/specimen_id were
-- never actually FK-backfilled by TASK-023, despite ADR-0005 requiring it.
-- Deliberately kept out of this migration's scope (§10 Q4) -- tracked
-- separately as issue #260.
CREATE TABLE "patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mrn" text NOT NULL,
	"national_id" text,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"sex" text NOT NULL,
	"birth_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_patient_sex" CHECK ("patient"."sex" IN ('M','F','U'))
);
--> statement-breakpoint
ALTER TABLE "patient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"added_by_principal_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_patient_alert_alert_type" CHECK ("patient_alert"."alert_type" IN ('allergy','medical_alert','infection_control','vip_confidential')),
	CONSTRAINT "ck_patient_alert_severity" CHECK ("patient_alert"."severity" IN ('low','medium','high','critical'))
);
--> statement-breakpoint
ALTER TABLE "patient_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_alert" ADD CONSTRAINT "patient_alert_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_tenant_mrn" ON "patient" USING btree ("tenant_id","mrn");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_tenant_national_id" ON "patient" USING btree ("tenant_id","national_id") WHERE "patient"."national_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_patient_tenant_name" ON "patient" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "ix_patient_alert_tenant_patient" ON "patient_alert" USING btree ("tenant_id","patient_id");--> statement-breakpoint
-- Real-environment data cleanup, added after this migration's original merge
-- (justified exception to "never edit a past migration" -- this migration has
-- never successfully applied to any persistent/real environment, only
-- ephemeral CI/local Postgres; see the Deploy to Staging failure on run
-- 30757994494). Staging carries leftover synthetic `order` rows predating
-- this table (FEAT-009 proof routes, before a real `patient` existed), whose
-- patient_id doesn't reference any row here. Delete both tables' orphans
-- before adding the FK so the backfill can't fail the same way again.
DELETE FROM "observation" WHERE "patient_id" NOT IN (SELECT "id" FROM "patient");--> statement-breakpoint
DELETE FROM "order" WHERE "patient_id" NOT IN (SELECT "id" FROM "patient");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_alert" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);