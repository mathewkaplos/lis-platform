-- TASK-063 (FEAT-018, docs/plans/feat-018-qc-materials-results-as-observations.md):
-- control_lot table + observation's QC subject columns, per ADR-0015
-- (accepted). drizzle-kit generated output, unmodified except for this
-- header and the file/tag rename (see packages/db/src/schema/control-lot.ts
-- and observation.ts for the full design rationale).
CREATE TABLE "control_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"level" text NOT NULL,
	"instrument_id" uuid,
	"unit_id" uuid NOT NULL,
	"target_mean" numeric NOT NULL,
	"target_sd" numeric NOT NULL,
	"lot_number" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_lot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation" ALTER COLUMN "ordered_test_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "observation" ALTER COLUMN "specimen_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "observation" ALTER COLUMN "patient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "is_control" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "control_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "control_lot" ADD CONSTRAINT "control_lot_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_lot" ADD CONSTRAINT "control_lot_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_control_lot_tenant_analyte" ON "control_lot" USING btree ("tenant_id","analyte_id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_control_lot_id_control_lot_id_fk" FOREIGN KEY ("control_lot_id") REFERENCES "public"."control_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "chk_observation_subject" CHECK ((is_control = false AND patient_id IS NOT NULL AND control_lot_id IS NULL) OR (is_control = true AND patient_id IS NULL AND control_lot_id IS NOT NULL));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "control_lot" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);