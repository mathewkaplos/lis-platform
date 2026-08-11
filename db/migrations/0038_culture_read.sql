CREATE TABLE "culture_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"result" text,
	"recorded_by" uuid,
	"due_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_culture_read_result" CHECK ("culture_read"."result" IN ('no_growth', 'growth')),
	CONSTRAINT "ck_culture_read_completion" CHECK (("culture_read"."completed_at" IS NULL AND "culture_read"."result" IS NULL) OR ("culture_read"."completed_at" IS NOT NULL AND "culture_read"."result" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "culture_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "culture_read" ADD CONSTRAINT "culture_read_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_culture_read_ordered_test" ON "culture_read" USING btree ("ordered_test_id");--> statement-breakpoint
CREATE INDEX "ix_culture_read_due" ON "culture_read" USING btree ("tenant_id","scheduled_at") WHERE "culture_read"."completed_at" IS NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "culture_read" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "scheduler_enumeration" ON "culture_read" AS PERMISSIVE FOR SELECT TO "lis_scheduler" USING (completed_at IS NULL);--> statement-breakpoint
-- Column-scoped GRANT, not drizzle-kit-expressible (schema file's own
-- header comment) -- every column the detector's own enumeration query
-- references anywhere (SELECT list or WHERE clause), per critical_
-- notification's own hard-won 0020 migration finding: Postgres's
-- column-level GRANT model requires SELECT privilege on every column
-- referenced anywhere in a query, not just the ones returned.
GRANT SELECT (tenant_id, completed_at, scheduled_at) ON "culture_read" TO "lis_scheduler";