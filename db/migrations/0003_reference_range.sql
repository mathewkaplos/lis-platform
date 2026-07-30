CREATE TABLE "reference_range" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"sex" text,
	"age_low_days" integer,
	"age_high_days" integer,
	"condition" text,
	"method" text,
	"specimen_type" text,
	"population" text,
	"range_type" text NOT NULL,
	"low" numeric,
	"high" numeric,
	"textual_range" text,
	"interpretation_when_in" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reference_range" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reference_range" ADD CONSTRAINT "reference_range_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_range" ADD CONSTRAINT "reference_range_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reference_range_tenant_analyte" ON "reference_range" USING btree ("tenant_id","analyte_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reference_range" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);