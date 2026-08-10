-- FEAT-040 (docs/plans/feat-040-fine-grained-abac-relationship-authz.md).
-- Drizzle-kit generated output, unmodified except for this header --
-- ADR-0011's own anticipated resolution: a clinician-patient relationship
-- is a plain, tenant-scoped Postgres table (RLS from this first migration,
-- Constitution Law #4), not a Keycloak user attribute. `clinician_user_id`
-- is the raw Keycloak `sub` -- no `user` table exists anywhere in this
-- codebase yet.
CREATE TABLE "care_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clinician_user_id" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_relationship" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_care_relationship_tenant_clinician_patient" ON "care_relationship" USING btree ("tenant_id","clinician_user_id","patient_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "care_relationship" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);