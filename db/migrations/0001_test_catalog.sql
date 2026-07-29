CREATE TABLE "panel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "panel_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panel_test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "test_analyte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_analyte" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "test_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_definition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "panel_test" ADD CONSTRAINT "panel_test_panel_id_panel_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_test" ADD CONSTRAINT "panel_test_test_definition_id_test_definition_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_analyte" ADD CONSTRAINT "test_analyte_test_definition_id_test_definition_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_analyte" ADD CONSTRAINT "test_analyte_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_panel_tenant_code" ON "panel" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_panel_test_panel_test_definition" ON "panel_test" USING btree ("panel_id","test_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_test_analyte_test_definition_analyte" ON "test_analyte" USING btree ("test_definition_id","analyte_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_test_definition_tenant_code" ON "test_definition" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "panel" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "panel_test" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "test_analyte" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "test_definition" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);