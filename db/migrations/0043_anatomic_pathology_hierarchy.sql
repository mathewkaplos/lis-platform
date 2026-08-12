CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"specimen_id" uuid NOT NULL,
	"block_number" integer NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_block_status" CHECK ("block"."status" IN ('active','disposed'))
);
--> statement-breakpoint
ALTER TABLE "block" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "block_fulfillment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "block_fulfillment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"accession_number" text NOT NULL,
	"status" text DEFAULT 'accessioned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_case_status" CHECK ("case"."status" IN ('accessioned','in_process','signed_out','amended'))
);
--> statement-breakpoint
ALTER TABLE "case" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "slide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"slide_number" integer NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_slide_status" CHECK ("slide"."status" IN ('active','disposed'))
);
--> statement-breakpoint
ALTER TABLE "slide" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "specimen" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_specimen_id_specimen_id_fk" FOREIGN KEY ("specimen_id") REFERENCES "public"."specimen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_fulfillment" ADD CONSTRAINT "block_fulfillment_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_fulfillment" ADD CONSTRAINT "block_fulfillment_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide" ADD CONSTRAINT "slide_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_block_tenant_code" ON "block" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ix_block_specimen" ON "block" USING btree ("specimen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_block_fulfillment_block_ordered_test" ON "block_fulfillment" USING btree ("block_id","ordered_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_case_tenant_accession" ON "case" USING btree ("tenant_id","accession_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_case_tenant_order" ON "case" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_slide_tenant_code" ON "slide" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ix_slide_block" ON "slide" USING btree ("block_id");--> statement-breakpoint
ALTER TABLE "specimen" ADD CONSTRAINT "specimen_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_specimen_case" ON "specimen" USING btree ("case_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "block" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "block_fulfillment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "slide" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);