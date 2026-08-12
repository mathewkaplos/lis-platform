-- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
CREATE TABLE "synoptic_element" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synoptic_protocol_version_id" uuid NOT NULL,
	"parent_element_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" text NOT NULL,
	"requirement" text NOT NULL,
	"analyte_id" uuid NOT NULL,
	"visibility_condition" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_synoptic_element_data_type" CHECK ("synoptic_element"."data_type" IN ('coded','quantity','text')),
	CONSTRAINT "ck_synoptic_element_requirement" CHECK ("synoptic_element"."requirement" IN ('required','recommended'))
);
--> statement-breakpoint
-- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
CREATE TABLE "synoptic_element_response_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synoptic_element_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
CREATE TABLE "synoptic_protocol" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_standard" text NOT NULL,
	"specimen_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- RLS-exempt per ADR-0050 (global reference data, identical across tenants)
CREATE TABLE "synoptic_protocol_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synoptic_protocol_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_synoptic_protocol_version_status" CHECK ("synoptic_protocol_version"."status" IN ('draft','in_review','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "synoptic_element" ADD CONSTRAINT "synoptic_element_synoptic_protocol_version_id_synoptic_protocol_version_id_fk" FOREIGN KEY ("synoptic_protocol_version_id") REFERENCES "public"."synoptic_protocol_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synoptic_element" ADD CONSTRAINT "synoptic_element_parent_element_id_synoptic_element_id_fk" FOREIGN KEY ("parent_element_id") REFERENCES "public"."synoptic_element"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synoptic_element" ADD CONSTRAINT "synoptic_element_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synoptic_element_response_option" ADD CONSTRAINT "synoptic_element_response_option_synoptic_element_id_synoptic_element_id_fk" FOREIGN KEY ("synoptic_element_id") REFERENCES "public"."synoptic_element"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synoptic_protocol_version" ADD CONSTRAINT "synoptic_protocol_version_synoptic_protocol_id_synoptic_protocol_id_fk" FOREIGN KEY ("synoptic_protocol_id") REFERENCES "public"."synoptic_protocol"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_synoptic_element_version_key" ON "synoptic_element" USING btree ("synoptic_protocol_version_id","key");--> statement-breakpoint
CREATE INDEX "ix_synoptic_element_parent" ON "synoptic_element" USING btree ("parent_element_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_synoptic_element_response_option_element_value" ON "synoptic_element_response_option" USING btree ("synoptic_element_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_synoptic_protocol_version_protocol_published" ON "synoptic_protocol_version" USING btree ("synoptic_protocol_id") WHERE "synoptic_protocol_version"."status" = 'published';