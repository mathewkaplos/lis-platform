-- TASK-065 (FEAT-021, docs/plans/feat-021-critical-notification-read-back-escalation.md):
-- critical_notification table, per ADR-0016 (accepted). drizzle-kit
-- generated output, unmodified except for this header and the file/tag
-- rename (see packages/db/src/schema/critical-notification.ts for the full
-- design rationale). Unlike observation's chk_observation_subject
-- (database-design Skill entry #9), the CHECK above is part of the same
-- CREATE TABLE statement, so the table-qualified reference is valid.
-- observation_id/observation_created_at is a composite FK, not a plain
-- single-column one, per ADR-0008's addendum (observation's PK is composite
-- post-partitioning) -- confirmed the hard way, a real failed migration run
-- on the first attempt at this file, same pattern as result_history's own
-- observation_id/observation_created_at columns.
CREATE TABLE "critical_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"last_escalated_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"read_back" text,
	CONSTRAINT "ck_critical_notification_status" CHECK ("critical_notification"."status" IN ('pending','acknowledged','escalated'))
);
--> statement-breakpoint
ALTER TABLE "critical_notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "critical_notification" ADD CONSTRAINT "critical_notification_observation_id_created_at_fk" FOREIGN KEY ("observation_id","observation_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_critical_notification_tenant_observation" ON "critical_notification" USING btree ("tenant_id","observation_id");--> statement-breakpoint
CREATE INDEX "ix_critical_notification_pending" ON "critical_notification" USING btree ("tenant_id","status") WHERE "critical_notification"."status" <> 'acknowledged';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "critical_notification" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);