-- TASK-023: order, ordered_test, specimen, specimen_fulfillment (M:N link),
-- per the approved FEAT-006 proposal.
--
-- drizzle-kit generated this file by diffing schema/index.ts against
-- meta/0006_snapshot.json -- the last snapshot that exists. 0007/0008 were
-- hand-written (triggers and PARTITION BY aren't representable by
-- drizzle-kit) and never got a companion snapshot, so drizzle-kit's
-- bookkeeping doesn't know those changes already happened on any real
-- database. The raw generated output therefore included redundant
-- statements re-adding observation's composite primary key, its
-- *_created_at companion columns, and the composite FKs into
-- observation/result_history -- all of which 0007/0008 already created.
-- Those statements have been manually removed below; this file contains
-- only the genuinely new DDL for TASK-023's four tables. The freshly
-- generated meta/0009_snapshot.json is unaffected by this edit (it's
-- computed from the current schema files, which already reflect the
-- post-partitioning shape) and is now the accurate baseline for future
-- `drizzle-kit generate` runs.
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ordered_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ordered_test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "specimen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"accession_number" text NOT NULL,
	"specimen_type" text NOT NULL,
	"parent_specimen_id" uuid,
	"status" text DEFAULT 'collected' NOT NULL,
	"rejection_reason" text,
	"collection_context" jsonb,
	"collected_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_specimen_status" CHECK ("specimen"."status" IN ('collected','received','accessioned','in_process','completed','archived','disposed','rejected')),
	CONSTRAINT "ck_specimen_rejection_reason" CHECK ("specimen"."rejection_reason" IS NULL OR "specimen"."rejection_reason" IN ('haemolysed','clotted','insufficient_volume','mislabelled','wrong_container','improper_temperature','expired'))
);
--> statement-breakpoint
ALTER TABLE "specimen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "specimen_fulfillment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"specimen_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "specimen_fulfillment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ordered_test" ADD CONSTRAINT "ordered_test_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordered_test" ADD CONSTRAINT "ordered_test_test_definition_id_test_definition_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specimen" ADD CONSTRAINT "specimen_parent_specimen_id_specimen_id_fk" FOREIGN KEY ("parent_specimen_id") REFERENCES "public"."specimen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specimen_fulfillment" ADD CONSTRAINT "specimen_fulfillment_specimen_id_specimen_id_fk" FOREIGN KEY ("specimen_id") REFERENCES "public"."specimen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specimen_fulfillment" ADD CONSTRAINT "specimen_fulfillment_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ordered_test_order" ON "ordered_test" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_specimen_tenant_accession" ON "specimen" USING btree ("tenant_id","accession_number");--> statement-breakpoint
CREATE INDEX "ix_specimen_parent" ON "specimen" USING btree ("parent_specimen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_specimen_fulfillment_specimen_ordered_test" ON "specimen_fulfillment" USING btree ("specimen_id","ordered_test_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ordered_test" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "specimen" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "specimen_fulfillment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);