ALTER TABLE "invoice" ADD COLUMN "invoice_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invoice_tenant_invoice_number" ON "invoice" USING btree ("tenant_id","invoice_number");