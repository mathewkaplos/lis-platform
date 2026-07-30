-- Fixes two FK integrity gaps in 0008_observation_partitioning.sql, found by
-- direct code review before merge (not by a failing test). See ADR-0008's
-- second addendum for the full writeup.
--
-- (1) Postgres composite FKs default to MATCH SIMPLE: the whole constraint is
-- skipped if ANY column in it is NULL. fn_observation_link_created_at's
-- previous_observation_id/amendment_of lookup leaves the companion
-- *_created_at column NULL when the caller-supplied id doesn't exist -- under
-- MATCH SIMPLE that silently disables the FK check entirely instead of
-- rejecting the bad id. Fixed here by switching
-- observation_previous_observation_id_created_at_fk and
-- observation_amendment_of_created_at_fk to MATCH FULL, which requires both
-- columns null or both non-null-and-matching, so a partial-null (bad id,
-- unresolved companion) is rejected. Deliberately NOT applied to
-- observation_superseded_by_created_at_fk: superseded_by/
-- superseded_by_created_at are always set together, atomically, from the
-- actual just-inserted successor row inside fn_observation_supersede -- there
-- is no caller-supplied-id code path here the way there is for
-- previous_observation_id/amendment_of.
--
-- (2) result_history.superseded_by had no FK constraint at all -- an
-- omission, not a deliberate exemption, inconsistent with this migration's
-- own stated principle of full DB-enforced referential integrity on every
-- column in Constitution Law #2's correction chain. Given the same
-- fn_observation_supersede trigger already knows the successor's created_at
-- atomically at INSERT time, this gets the same companion-column treatment,
-- but as NOT NULL (a result_history row is never created without a
-- successor, unlike previous_observation_id/amendment_of which are
-- legitimately optional) -- so MATCH SIMPLE and MATCH FULL are equivalent
-- here; left at the default for consistency with
-- observation_superseded_by_created_at_fk.

ALTER TABLE "observation" DROP CONSTRAINT "observation_previous_observation_id_created_at_fk";--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_previous_observation_id_created_at_fk" FOREIGN KEY ("previous_observation_id","previous_observation_created_at") REFERENCES "public"."observation"("id","created_at") MATCH FULL ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "observation" DROP CONSTRAINT "observation_amendment_of_created_at_fk";--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_amendment_of_created_at_fk" FOREIGN KEY ("amendment_of","amendment_of_created_at") REFERENCES "public"."observation"("id","created_at") MATCH FULL ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "result_history" ADD COLUMN "superseded_by_created_at" timestamp with time zone;--> statement-breakpoint
-- Backfill for any row inserted before this migration (none expected at this
-- milestone -- no production data -- but not assumed).
UPDATE "result_history" AS rh SET "superseded_by_created_at" = o."created_at"
FROM "observation" o
WHERE o."id" = rh."superseded_by" AND rh."superseded_by_created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "result_history" ALTER COLUMN "superseded_by_created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_superseded_by_created_at_fk" FOREIGN KEY ("superseded_by","superseded_by_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- fn_observation_supersede updated to populate the new companion column in
-- the same INSERT that already writes superseded_by -- NEW.created_at (the
-- successor row being inserted right now) is always known synchronously here,
-- no lookup/trigger needed the way previous_observation_created_at/
-- amendment_of_created_at require.
CREATE OR REPLACE FUNCTION fn_observation_supersede() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amendment_of IS NOT NULL THEN
    INSERT INTO result_history (tenant_id, observation_id, observation_created_at, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, superseded_by, superseded_by_created_at)
    SELECT tenant_id, id, created_at, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, NEW.id, NEW.created_at
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
