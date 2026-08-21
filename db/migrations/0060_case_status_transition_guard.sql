-- Issue #671 (docs/plans/task-671-case-status-transition-guard.md). DB-level
-- backstop for case.status transitions -- defense in depth, not a behavior
-- change; every transition listed here is already the exact set
-- case.controller.ts's own application guards already enforce (screen,
-- returnToScreening, finalize, amend). Hand-written, like
-- fn_case_report_version_append_only (0045_case_report_version.sql) --
-- triggers/functions aren't representable in the Drizzle schema builder
-- used by packages/db.
--
-- Sync note: if a future issue adds a new case.status value or a new
-- application-level transition, update BOTH this trigger's transition list
-- AND case.controller.ts's own guards together -- each references the
-- other by comment.
CREATE OR REPLACE FUNCTION fn_case_status_transition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status, NEW.status) IN (
    ('accessioned', 'pending_review'),   -- screen()
    ('in_process', 'pending_review'),    -- screen()
    ('pending_review', 'in_process'),    -- returnToScreening()
    ('accessioned', 'signed_out'),       -- finalize()
    ('in_process', 'signed_out'),        -- finalize()
    ('pending_review', 'signed_out'),    -- finalize()
    ('signed_out', 'amended'),           -- amend()
    ('amended', 'amended')               -- amend() re-amending an already-amended case
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal case status transition % -> % for case % (Constitution Law #2 applied to case.status)', OLD.status, NEW.status, OLD.id;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_case_status_transition_guard
  BEFORE UPDATE ON "case"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_case_status_transition_guard();
