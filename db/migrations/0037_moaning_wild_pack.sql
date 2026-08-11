CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invoice_status" CHECK ("invoice"."status" IN ('unpaid','partial','paid'))
);
--> statement-breakpoint
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"billing_code" text,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_line_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider_reference" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payment_method" CHECK ("payment"."method" IN ('cash','mobile_money')),
	CONSTRAINT "ck_payment_status" CHECK ("payment"."status" IN ('pending','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "test_definition" ADD COLUMN "billing_code" text;--> statement-breakpoint
ALTER TABLE "test_definition" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_test_definition_id_test_definition_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_invoice_tenant_order" ON "invoice" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "ix_invoice_line_item_tenant_invoice" ON "invoice_line_item" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "ix_payment_tenant_invoice" ON "payment" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_line_item" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);