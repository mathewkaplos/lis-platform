CREATE TABLE "referring_facility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referring_facility" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "next_of_kin_name" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "next_of_kin_phone" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "referring_facility_id" uuid;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "ordering_provider_name" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "payer_type" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "referring_facility_id" uuid;--> statement-breakpoint
CREATE INDEX "ix_referring_facility_tenant_name" ON "referring_facility" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_referring_facility_id_referring_facility_id_fk" FOREIGN KEY ("referring_facility_id") REFERENCES "public"."referring_facility"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_referring_facility_id_referring_facility_id_fk" FOREIGN KEY ("referring_facility_id") REFERENCES "public"."referring_facility"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_order_referring_facility" ON "order" USING btree ("referring_facility_id");--> statement-breakpoint
CREATE INDEX "ix_invoice_referring_facility" ON "invoice" USING btree ("referring_facility_id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "ck_invoice_payer_type" CHECK ("invoice"."payer_type" IN ('cash','corporate'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "referring_facility" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);