CREATE TABLE "case_report_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"included_content" jsonb NOT NULL,
	"signature" "bytea" NOT NULL,
	"signed_by_user_id" uuid NOT NULL,
	"signed_by_role" text NOT NULL,
	"auth_time_used" timestamp with time zone NOT NULL,
	"amendment_of" uuid,
	"reason" text,
	"superseded_by" uuid,
	"status" text DEFAULT 'final' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_case_report_version_status" CHECK ("case_report_version"."status" IN ('final','superseded'))
);
--> statement-breakpoint
ALTER TABLE "case_report_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_report_version" ADD CONSTRAINT "case_report_version_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_report_version" ADD CONSTRAINT "case_report_version_amendment_of_case_report_version_id_fk" FOREIGN KEY ("amendment_of") REFERENCES "public"."case_report_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_report_version" ADD CONSTRAINT "case_report_version_superseded_by_case_report_version_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."case_report_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_case_report_version_case_version" ON "case_report_version" USING btree ("case_id","version_number");--> statement-breakpoint
CREATE INDEX "ix_case_report_version_tenant_case" ON "case_report_version" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "ix_case_report_version_amendment_of" ON "case_report_version" USING btree ("amendment_of");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case_report_version" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
-- FEAT-059: append-only enforcement (Constitution Law #2 applied to this
-- table, ADR-0051), hand-written like fn_observation_append_only/
-- fn_observation_supersede (0007_observation_append_only_trigger.sql) --
-- triggers/functions aren't representable in the Drizzle schema builder
-- used by packages/db.
--
-- Unlike observation (which allows free edits pre-verification), a
-- case_report_version row is only ever inserted already-signed -- there is
-- no draft/preliminary state -- so ANY update after insert is rejected,
-- with exactly one narrow exception: superseded_by may be set, and only
-- when the UPDATE is itself nested inside fn_case_report_version_supersede's
-- own internal UPDATE (pg_trigger_depth() > 1), never by a direct top-level
-- application UPDATE.
CREATE OR REPLACE FUNCTION fn_case_report_version_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1
     AND OLD.superseded_by IS NULL
     AND NEW.superseded_by IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_by' - 'status') = (to_jsonb(OLD) - 'superseded_by' - 'status')
  THEN
    RETURN NEW; -- system-internal supersession backfill only
  END IF;
  RAISE EXCEPTION 'case_report_version % is signed and append-only (Constitution Law #2): amendments must insert a new version, not update this one', OLD.id;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_case_report_version_append_only
  BEFORE UPDATE ON case_report_version
  FOR EACH ROW
  EXECUTE FUNCTION fn_case_report_version_append_only();
--> statement-breakpoint
-- When an amending row is inserted (amendment_of set), atomically mark the
-- version it amends as superseded -- same old->new / new->old split
-- ADR-0007 already established for observation.amendment_of/superseded_by.
CREATE OR REPLACE FUNCTION fn_case_report_version_supersede() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amendment_of IS NOT NULL THEN
    UPDATE case_report_version
    SET superseded_by = NEW.id, status = 'superseded'
    WHERE id = NEW.amendment_of
      AND superseded_by IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_case_report_version_supersede
  AFTER INSERT ON case_report_version
  FOR EACH ROW
  EXECUTE FUNCTION fn_case_report_version_supersede();