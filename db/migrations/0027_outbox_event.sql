-- FEAT-028 (ADR-0028): outbox_event's tenant_isolation uses the 2-arg
-- current_setting(..., missing_ok) form from this, its first migration --
-- see the schema file's own header comment for why (critical_notification's
-- hard-won fix, ADR-0017/migration 0019, reused here rather than
-- reproducing the same bug). lis_scheduler already exists (0018_lis_
-- scheduler_role.sql) -- this migration only grants it visibility into a
-- second table, same column-scoped shape as its existing critical_
-- notification grant.
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "ck_outbox_event_status" CHECK ("outbox_event"."status" IN ('pending','processed'))
);
--> statement-breakpoint
ALTER TABLE "outbox_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT (tenant_id) ON "outbox_event" TO "lis_scheduler";--> statement-breakpoint
CREATE INDEX "ix_outbox_event_pending" ON "outbox_event" USING btree ("tenant_id","status") WHERE "outbox_event"."status" = 'pending';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_event" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "scheduler_enumeration" ON "outbox_event" AS PERMISSIVE FOR SELECT TO "lis_scheduler" USING (status = 'pending');