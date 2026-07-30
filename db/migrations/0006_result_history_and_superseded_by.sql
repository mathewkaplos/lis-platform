CREATE TABLE "result_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"data_type" "observation_data_type" NOT NULL,
	"value_num" numeric,
	"value_code" text,
	"value_bool" boolean,
	"value_text" text,
	"value_datetime" timestamp with time zone,
	"value_json" jsonb,
	"status" text NOT NULL,
	"superseded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "result_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_observation_id_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_result_history_observation" ON "result_history" USING btree ("observation_id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_superseded_by_observation_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "result_history" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);