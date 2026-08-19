CREATE TABLE "case_narrative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"gross_description" text,
	"microscopic_description" text,
	"diagnosis" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "case_narrative" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_narrative" ADD CONSTRAINT "case_narrative_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_case_narrative_case" ON "case_narrative" USING btree ("case_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case_narrative" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);