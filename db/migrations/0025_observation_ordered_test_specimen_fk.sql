-- ADR-0005's forward-reference FK backfill for these two columns (issue #260):
-- required by ADR-0005's own acceptance criteria to land in the same
-- migration that created ordered_test/specimen (TASK-023), silently unmet
-- since. Both columns stay nullable per ADR-0015 (QC rows carry neither) --
-- a plain FK only constrains non-null values, so this doesn't touch that.
-- Constraint names are drizzle-kit's default auto-generated form, matching
-- observation_patient_id_patient_id_fk's own naming (0012_patient.sql) --
-- not the shorter names issue #260's own suggested fix used, for
-- consistency with the sibling FK already on this table.
ALTER TABLE "observation" ADD CONSTRAINT "observation_ordered_test_id_ordered_test_id_fk" FOREIGN KEY ("ordered_test_id") REFERENCES "public"."ordered_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_specimen_id_specimen_id_fk" FOREIGN KEY ("specimen_id") REFERENCES "public"."specimen"("id") ON DELETE no action ON UPDATE no action;