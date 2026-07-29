-- RLS-exempt per ADR-0004 (global reference data, identical across tenants)
CREATE TABLE "analyte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_system_value_id" uuid NOT NULL,
	"display" text NOT NULL,
	"data_type" text NOT NULL,
	"default_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyte_code_system_value_id_unique" UNIQUE("code_system_value_id")
);
--> statement-breakpoint
-- RLS-exempt per ADR-0004 (global reference data, identical across tenants)
CREATE TABLE "code_system_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system" text NOT NULL,
	"code" text NOT NULL,
	"version" text NOT NULL,
	"display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- RLS-exempt per ADR-0004 (global reference data, identical across tenants)
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_system_value_id" uuid NOT NULL,
	"display_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyte" ADD CONSTRAINT "analyte_code_system_value_id_code_system_value_id_fk" FOREIGN KEY ("code_system_value_id") REFERENCES "public"."code_system_value"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyte" ADD CONSTRAINT "analyte_default_unit_id_unit_id_fk" FOREIGN KEY ("default_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_code_system_value_id_code_system_value_id_fk" FOREIGN KEY ("code_system_value_id") REFERENCES "public"."code_system_value"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_code_system_value_system_code_version" ON "code_system_value" USING btree ("system","code","version");