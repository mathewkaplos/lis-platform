DROP INDEX "ix_invoice_tenant_order";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invoice_tenant_order" ON "invoice" USING btree ("tenant_id","order_id");