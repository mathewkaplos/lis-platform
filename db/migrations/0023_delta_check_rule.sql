-- FEAT-025 (docs/plans/feat-025-delta-checks.md): delta_check_rule table, per
-- ADR-0023 (accepted). drizzle-kit generated output, unmodified except for
-- this header and the file/tag rename (see
-- packages/db/src/schema/delta-check-rule.ts for the full design
-- rationale). Percent-only threshold, one row per (tenant, analyte) --
-- absolute-threshold and time-windowed lookback are named, deferred future
-- work per ADR-0023's own "why not" section, not built here.
CREATE TABLE "delta_check_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"threshold_percent" numeric NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delta_check_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delta_check_rule" ADD CONSTRAINT "delta_check_rule_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_delta_check_rule_tenant_analyte" ON "delta_check_rule" USING btree ("tenant_id","analyte_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "delta_check_rule" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);