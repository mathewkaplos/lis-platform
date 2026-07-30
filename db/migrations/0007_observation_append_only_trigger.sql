-- TASK-021: append-only enforcement (Constitution Law #2) + result_history.
-- Hand-written (not drizzle-kit generated): triggers/functions aren't
-- representable in the Drizzle schema builder used by packages/db.
--
-- Once an observation reaches status='verified', no column may be mutated
-- again, with exactly one narrow exception: superseded_by may be set, and
-- only when the UPDATE is itself nested inside fn_observation_supersede's
-- own internal UPDATE (pg_trigger_depth() > 1) -- never by a direct,
-- top-level application UPDATE. This is what makes ADR-0007's negative-test
-- acceptance criterion (a standalone `UPDATE ... SET superseded_by = ...`
-- must be rejected) actually hold, not just documented as atomic.
CREATE OR REPLACE FUNCTION fn_observation_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified' THEN
    IF pg_trigger_depth() > 1
       AND OLD.superseded_by IS NULL
       AND NEW.superseded_by IS NOT NULL
       AND (to_jsonb(NEW) - 'superseded_by') = (to_jsonb(OLD) - 'superseded_by')
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
-- When a correcting row is inserted (amendment_of set, new->old per KB-06),
-- archive the predecessor's final state into result_history, then set its
-- superseded_by (old->new per ADR-0007) atomically with the insert. Both
-- writes happen from inside this one AFTER INSERT trigger, so
-- fn_observation_append_only sees pg_trigger_depth() > 1 for the nested
-- UPDATE and allows it.
CREATE OR REPLACE FUNCTION fn_observation_supersede() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amendment_of IS NOT NULL THEN
    INSERT INTO result_history (tenant_id, observation_id, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, superseded_by)
    SELECT tenant_id, id, data_type, value_num, value_code, value_bool, value_text, value_datetime, value_json, status, NEW.id
    FROM observation
    WHERE id = NEW.amendment_of
      AND superseded_by IS NULL;

    UPDATE observation
    SET superseded_by = NEW.id
    WHERE id = NEW.amendment_of
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
