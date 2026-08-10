CREATE TABLE "report_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_template_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_template_version_status" CHECK ("report_template_version"."status" IN ('draft','in_review','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "report_template_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "report_template" ADD CONSTRAINT "report_template_test_definition_id_test_definition_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_version" ADD CONSTRAINT "report_template_version_report_template_id_report_template_id_fk" FOREIGN KEY ("report_template_id") REFERENCES "public"."report_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_report_template_tenant_test_definition" ON "report_template" USING btree ("tenant_id","test_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_report_template_version_template_published" ON "report_template_version" USING btree ("report_template_id") WHERE "report_template_version"."status" = 'published';--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_template_version_id_report_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."report_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_template" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_template_version" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);