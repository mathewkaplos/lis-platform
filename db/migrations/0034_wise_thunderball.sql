-- FEAT-039 (docs/plans/feat-039-patient-portal.md). Drizzle-kit generated
-- output, unmodified except for this header -- two new tenant-scoped
-- tables (RLS from this first migration, Constitution Law #4):
-- patient_portal_account (a Keycloak sub <-> exactly one patient row, 1:1
-- both directions) and result_release_policy (one row per tenant, a
-- deliberately minimal immediate/delayed gate -- KB-32's own much larger
-- "jurisdiction-aware release rules" target is the destination, not v1).
CREATE TABLE "patient_portal_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_user_id" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_portal_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "result_release_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" text DEFAULT 'immediate' NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_result_release_policy_mode" CHECK ("result_release_policy"."mode" IN ('immediate', 'delayed'))
);
--> statement-breakpoint
ALTER TABLE "result_release_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_portal_account" ADD CONSTRAINT "patient_portal_account_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_portal_account_tenant_user" ON "patient_portal_account" USING btree ("tenant_id","patient_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_patient_portal_account_tenant_patient" ON "patient_portal_account" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_result_release_policy_tenant" ON "result_release_policy" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_portal_account" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "result_release_policy" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);