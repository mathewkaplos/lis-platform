CREATE TYPE "public"."observation_data_type" AS ENUM('quantity', 'ordinal', 'coded', 'boolean', 'text', 'ratio', 'datetime', 'table', 'structured', 'attachment');--> statement-breakpoint
CREATE TABLE "observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"specimen_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data_type" "observation_data_type" NOT NULL,
	"value_num" numeric,
	"value_code" text,
	"value_bool" boolean,
	"value_text" text,
	"value_json" jsonb,
	"unit_id" uuid,
	"unit" text,
	"ref_low" numeric,
	"ref_high" numeric,
	"ref_condition" text,
	"ref_source" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"interpretation" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"method_id" uuid,
	"source" text NOT NULL,
	"instrument_id" uuid,
	"operator_user_id" uuid,
	"verifier_user_id" uuid,
	"produced_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"previous_observation_id" uuid,
	"amendment_of" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_observation_quantity_value" CHECK (("observation"."data_type" <> 'quantity') OR ("observation"."value_num" IS NOT NULL)),
	CONSTRAINT "ck_observation_ratio_value" CHECK (("observation"."data_type" <> 'ratio') OR ("observation"."value_num" IS NOT NULL) OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_ordinal_value" CHECK (("observation"."data_type" <> 'ordinal') OR ("observation"."value_code" IS NOT NULL)),
	CONSTRAINT "ck_observation_coded_value" CHECK (("observation"."data_type" <> 'coded') OR ("observation"."value_code" IS NOT NULL)),
	CONSTRAINT "ck_observation_boolean_value" CHECK (("observation"."data_type" <> 'boolean') OR ("observation"."value_bool" IS NOT NULL)),
	CONSTRAINT "ck_observation_text_value" CHECK (("observation"."data_type" <> 'text') OR ("observation"."value_text" IS NOT NULL)),
	CONSTRAINT "ck_observation_datetime_value" CHECK (("observation"."data_type" <> 'datetime') OR ("observation"."value_text" IS NOT NULL)),
	CONSTRAINT "ck_observation_table_value" CHECK (("observation"."data_type" <> 'table') OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_structured_value" CHECK (("observation"."data_type" <> 'structured') OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_attachment_value" CHECK (("observation"."data_type" <> 'attachment') OR ("observation"."value_json" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_previous_observation_id_observation_id_fk" FOREIGN KEY ("previous_observation_id") REFERENCES "public"."observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_amendment_of_observation_id_fk" FOREIGN KEY ("amendment_of") REFERENCES "public"."observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_obs_trend" ON "observation" USING btree ("tenant_id","patient_id","analyte_id","produced_at");--> statement-breakpoint
CREATE INDEX "ix_obs_ordered_test" ON "observation" USING btree ("ordered_test_id");--> statement-breakpoint
CREATE INDEX "ix_obs_flags" ON "observation" USING gin ("flags");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "observation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);