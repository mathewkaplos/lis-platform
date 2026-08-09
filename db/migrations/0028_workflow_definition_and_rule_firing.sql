CREATE TABLE "workflow_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_workflow_definition_status" CHECK ("workflow_definition"."status" IN ('draft','in_review','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "workflow_definition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_rule_firing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"event_type" text NOT NULL,
	"matched" boolean NOT NULL,
	"command" text,
	"dispatched" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_rule_firing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_workflow_definition_tenant_published" ON "workflow_definition" USING btree ("tenant_id") WHERE "workflow_definition"."status" = 'published';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "workflow_definition" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "workflow_rule_firing" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid);