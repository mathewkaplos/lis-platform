-- FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md).
-- The `sla_breach` table itself and the `ordered_test` policy changes below
-- are drizzle-kit generated output, unmodified except for this header and
-- the hand-written GRANT (roles/grants have no schema.ts representation,
-- same convention db/migrations/0018_lis_scheduler_role.sql already
-- established for critical_notification's own scheduler grant). `lis_scheduler`
-- already exists (0018) -- no CREATE ROLE here, just a new, narrow,
-- column-scoped SELECT on a second table.
GRANT SELECT (tenant_id, created_at, status) ON "ordered_test" TO "lis_scheduler";
--> statement-breakpoint
CREATE TABLE "sla_breach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"breached_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"last_escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sla_breach_priority" CHECK ("sla_breach"."priority" IN ('routine', 'stat')),
	CONSTRAINT "ck_sla_breach_status" CHECK ("sla_breach"."status" IN ('pending', 'escalated', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "sla_breach" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sla_breach" ADD CONSTRAINT "sla_breach_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sla_breach_ordered_test_open" ON "sla_breach" USING btree ("ordered_test_id") WHERE "sla_breach"."status" <> 'resolved';--> statement-breakpoint
CREATE POLICY "scheduler_enumeration" ON "ordered_test" AS PERMISSIVE FOR SELECT TO "lis_scheduler" USING (status NOT IN ('reported', 'cancelled', 'rejected'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sla_breach" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "ordered_test" TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid);