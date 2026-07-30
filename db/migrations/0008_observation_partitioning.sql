-- TASK-022: partition observation by time + trend indexes, per ADR-0008.
-- Hand-written (not drizzle-kit generated): PARTITION BY isn't representable
-- by drizzle-kit, and Postgres cannot ALTER an existing regular table into a
-- partitioned one -- this drops and recreates observation/result_history.
-- Valid only because "no production data exists at this milestone" (FEAT-005's
-- own rollback plan); ADR-0008's addendum is explicit that this drop/recreate
-- approach must NOT be reused once real data exists -- a future repartitioning
-- needs the standard create-new-table-and-backfill pattern instead.
--
-- ADR-0008's addendum also requires: partitioning by created_at forces
-- observation's primary key to become composite (id, created_at), which in
-- turn requires every FK that referenced observation(id) alone --
-- previous_observation_id, amendment_of, superseded_by, and
-- result_history.observation_id -- to carry a companion *_created_at column
-- and reference the composite key instead.

DROP TABLE IF EXISTS "result_history";
DROP TABLE IF EXISTS "observation";

CREATE TABLE "observation" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordered_test_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"specimen_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data_type" "observation_data_type" NOT NULL,
	"value_num" numeric,
	"value_code" text,
	"value_bool" boolean,
	"value_text" text,
	"value_datetime" timestamp with time zone,
	"value_json" jsonb,
	"unit_id" uuid,
	"unit" text,
	"ref_low" numeric,
	"ref_high" numeric,
	"ref_condition" text,
	"ref_source" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"interpretation" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"method_id" uuid,
	"source" text NOT NULL,
	"instrument_id" uuid,
	"operator_user_id" uuid,
	"verifier_user_id" uuid,
	"produced_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"previous_observation_id" uuid,
	"previous_observation_created_at" timestamp with time zone,
	"amendment_of" uuid,
	"amendment_of_created_at" timestamp with time zone,
	"superseded_by" uuid,
	"superseded_by_created_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_id_created_at_pk" PRIMARY KEY ("id","created_at"),
	CONSTRAINT "ck_observation_quantity_value" CHECK (("observation"."data_type" <> 'quantity') OR ("observation"."value_num" IS NOT NULL)),
	CONSTRAINT "ck_observation_ratio_value" CHECK (("observation"."data_type" <> 'ratio') OR ("observation"."value_num" IS NOT NULL) OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_ordinal_value" CHECK (("observation"."data_type" <> 'ordinal') OR ("observation"."value_code" IS NOT NULL)),
	CONSTRAINT "ck_observation_coded_value" CHECK (("observation"."data_type" <> 'coded') OR ("observation"."value_code" IS NOT NULL)),
	CONSTRAINT "ck_observation_boolean_value" CHECK (("observation"."data_type" <> 'boolean') OR ("observation"."value_bool" IS NOT NULL)),
	CONSTRAINT "ck_observation_text_value" CHECK (("observation"."data_type" <> 'text') OR ("observation"."value_text" IS NOT NULL)),
	CONSTRAINT "ck_observation_datetime_value" CHECK (("observation"."data_type" <> 'datetime') OR ("observation"."value_datetime" IS NOT NULL)),
	CONSTRAINT "ck_observation_table_value" CHECK (("observation"."data_type" <> 'table') OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_structured_value" CHECK (("observation"."data_type" <> 'structured') OR ("observation"."value_json" IS NOT NULL)),
	CONSTRAINT "ck_observation_attachment_value" CHECK (("observation"."data_type" <> 'attachment') OR ("observation"."value_json" IS NOT NULL))
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint

-- Yearly range partitions covering a 5-year span either side of this
-- migration's date (2026-07-30), matching the AC's own "5-year trend query"
-- framing, plus a DEFAULT partition required by Postgres for any row outside
-- the materialized ranges. Partition maintenance (creating future years'
-- partitions ahead of time, archiving old ones) is tracked as a follow-up
-- per ADR-0008's Consequences, not built here.
CREATE TABLE "observation_y2024" PARTITION OF "observation"
	FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "observation_y2025" PARTITION OF "observation"
	FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "observation_y2026" PARTITION OF "observation"
	FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "observation_y2027" PARTITION OF "observation"
	FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "observation_y2028" PARTITION OF "observation"
	FOR VALUES FROM ('2028-01-01 00:00:00+00') TO ('2029-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "observation_default" PARTITION OF "observation" DEFAULT;
--> statement-breakpoint

ALTER TABLE "observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Belt-and-suspenders: RLS policies on the parent apply through inherited
-- queries against partitions per PostgreSQL 16 docs (ddl-inherit.html), and
-- new partitions inherit the parent's row-security-enabled state, but this
-- is verified for real against a running instance (never assumed) as part of
-- this task's testing -- explicitly enabling on every partition too costs
-- nothing and removes any doubt.
ALTER TABLE "observation_y2024" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation_y2025" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation_y2026" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation_y2027" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation_y2028" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observation_default" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "observation" ADD CONSTRAINT "observation_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_previous_observation_id_created_at_fk" FOREIGN KEY ("previous_observation_id","previous_observation_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_amendment_of_created_at_fk" FOREIGN KEY ("amendment_of","amendment_of_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_superseded_by_created_at_fk" FOREIGN KEY ("superseded_by","superseded_by_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Indexes created on the parent propagate automatically to every existing
-- and future partition as local, per-partition indexes (PostgreSQL 16 docs,
-- ddl-partitioning.html) -- confirmed against pg_indexes during testing, not
-- assumed.
CREATE INDEX "ix_obs_trend" ON "observation" USING btree ("tenant_id","patient_id","analyte_id","produced_at");--> statement-breakpoint
CREATE INDEX "ix_obs_ordered_test" ON "observation" USING btree ("ordered_test_id");--> statement-breakpoint
CREATE INDEX "ix_obs_flags" ON "observation" USING gin ("flags");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "observation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

CREATE TABLE "result_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_created_at" timestamp with time zone NOT NULL,
	"data_type" "observation_data_type" NOT NULL,
	"value_num" numeric,
	"value_code" text,
	"value_bool" boolean,
	"value_text" text,
	"value_datetime" timestamp with time zone,
	"value_json" jsonb,
	"status" text NOT NULL,
	"superseded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "result_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_observation_id_created_at_fk" FOREIGN KEY ("observation_id","observation_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_result_history_observation" ON "result_history" USING btree ("observation_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "result_history" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

-- TASK-021 triggers, recreated (dropped along with the old observation
-- table). fn_observation_append_only's exception-narrowing comparison is
-- updated per ADR-0008's addendum: it must also strip
-- superseded_by_created_at from both sides, or the new companion column --
-- which legitimately changes in the same trigger-mediated UPDATE as
-- superseded_by -- makes the jsonb-equality guard fail and incorrectly
-- reject the legitimate supersession path.
CREATE OR REPLACE FUNCTION fn_observation_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified' THEN
    IF pg_trigger_depth() > 1
       AND OLD.superseded_by IS NULL
       AND NEW.superseded_by IS NOT NULL
       AND NEW.superseded_by_created_at IS NOT NULL
       AND (to_jsonb(NEW) - 'superseded_by' - 'superseded_by_created_at') = (to_jsonb(OLD) - 'superseded_by' - 'superseded_by_created_at')
    THEN
      RETURN NEW; -- system-internal supersession backfill only
    END IF;
    RAISE EXCEPTION 'observation % is verified and append-only (Constitution Law #2): corrections must insert a new row, not update this one', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_observation_append_only
  BEFORE UPDATE ON observation
  FOR EACH ROW
  EXECUTE FUNCTION fn_observation_append_only();
--> statement-breakpoint

-- New for TASK-022 / ADR-0008: auto-populates the previous_observation_id /
-- amendment_of companion created_at columns the composite FK requires, so
-- application call sites keep setting only previous_observation_id /
-- amendment_of as before -- the partitioning implementation detail never
-- becomes a caller's responsibility. Runs BEFORE INSERT, ahead of
-- fn_observation_supersede (AFTER INSERT), so amendment_of_created_at is
-- already populated by the time that trigger reads it.
CREATE OR REPLACE FUNCTION fn_observation_link_created_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.previous_observation_id IS NOT NULL AND NEW.previous_observation_created_at IS NULL THEN
    SELECT created_at INTO NEW.previous_observation_created_at
    FROM observation WHERE id = NEW.previous_observation_id;
  END IF;
  IF NEW.amendment_of IS NOT NULL AND NEW.amendment_of_created_at IS NULL THEN
    SELECT created_at INTO NEW.amendment_of_created_at
    FROM observation WHERE id = NEW.amendment_of;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_observation_link_created_at
  BEFORE INSERT ON observation
  FOR EACH ROW
  EXECUTE FUNCTION fn_observation_link_created_at();
--> statement-breakpoint

-- Updated for TASK-022 / ADR-0008: result_history now carries
-- observation_created_at, and the predecessor UPDATE also sets
-- superseded_by_created_at atomically with superseded_by. The WHERE clauses
-- now filter on (id, created_at) rather than id alone, which also lets
-- Postgres prune to the single relevant partition for both the SELECT and
-- the UPDATE.
CREATE OR REPLACE FUNCTION fn_observation_supersede() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amendment_of IS NOT NULL THEN
    INSERT INTO result_history (tenant_id, observation_id, observation_created_at, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, superseded_by)
    SELECT tenant_id, id, created_at, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, NEW.id
    FROM observation
    WHERE id = NEW.amendment_of
      AND created_at = NEW.amendment_of_created_at
      AND superseded_by IS NULL;

    UPDATE observation
    SET superseded_by = NEW.id,
        superseded_by_created_at = NEW.created_at
    WHERE id = NEW.amendment_of
      AND created_at = NEW.amendment_of_created_at
      AND superseded_by IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_observation_supersede
  AFTER INSERT ON observation
  FOR EACH ROW
  EXECUTE FUNCTION fn_observation_supersede();
