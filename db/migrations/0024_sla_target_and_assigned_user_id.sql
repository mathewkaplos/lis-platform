-- FEAT-022 Part 1 (docs/plans/feat-022-worklist-v2-sla-assignment-bulk.md):
-- sla_target table + ordered_test.assigned_user_id, per ADR-0024 (accepted).
-- drizzle-kit generated output, unmodified except for this header and the
-- file/tag rename (see packages/db/src/schema/sla-target.ts and
-- packages/db/src/schema/order.ts for the full design rationale).
-- assigned_user_id has no FK -- no user table exists yet (M2), same
-- established precedent as observation.operatorUserId/verifierUserId.
CREATE TABLE "sla_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sla_target_priority" CHECK ("sla_target"."priority" IN ('routine', 'stat'))
);
--> statement-breakpoint
ALTER TABLE "sla_target" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ordered_test" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sla_target_tenant_priority" ON "sla_target" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sla_target" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);