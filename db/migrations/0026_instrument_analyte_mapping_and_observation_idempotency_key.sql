CREATE TABLE "instrument_analyte_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instrument_id" text NOT NULL,
	"channel_code" text NOT NULL,
	"analyte_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"conversion_factor" numeric DEFAULT '1' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_instrument_mapping_status" CHECK ("instrument_analyte_mapping"."status" IN ('draft','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "instrument_analyte_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "observation_idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_idempotency_key" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observation_idempotency_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "source_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "instrument_analyte_mapping" ADD CONSTRAINT "instrument_analyte_mapping_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_analyte_mapping" ADD CONSTRAINT "instrument_analyte_mapping_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_instrument_mapping_published" ON "instrument_analyte_mapping" USING btree ("tenant_id","instrument_id","channel_code") WHERE "instrument_analyte_mapping"."status" = 'published';--> statement-breakpoint
CREATE INDEX "ix_instrument_mapping_lookup" ON "instrument_analyte_mapping" USING btree ("tenant_id","instrument_id","channel_code","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_observation_idempotency_key_tenant_key" ON "observation_idempotency_key" USING btree ("tenant_id","source_idempotency_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "instrument_analyte_mapping" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "observation_idempotency_key" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);