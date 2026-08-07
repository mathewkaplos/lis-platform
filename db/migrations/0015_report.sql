-- TASK-059 (FEAT-016 revision, docs/plans/feat-016-minimal-report.md §10 Q1,
-- resolved Option A): report provenance/hash record. drizzle-kit generated
-- output, unmodified except for this header and the file/tag rename (see
-- packages/db/src/schema/report.ts for the full design rationale).
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"included_observations" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by_user_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_report_tenant_ordered_test" ON "report" USING btree ("tenant_id","ordered_test_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);