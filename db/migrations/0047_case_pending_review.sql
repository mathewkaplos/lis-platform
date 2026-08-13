-- FEAT-063 (docs/plans/feat-063-cytology-two-tier-workflow.md). Adds
-- 'pending_review' to ck_case_status -- a CHECK constraint cannot be altered
-- in place, so this is a real DROP/ADD pair (engineering/database-design
-- Skill), not an additive-only migration like every prior AP migration this
-- session (FEAT-057/059/061 all only ever added new tables). No data
-- migration needed: 'pending_review' is additive to the value set, no
-- pre-existing row could hold it.
ALTER TABLE "case" DROP CONSTRAINT "ck_case_status";--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "ck_case_status" CHECK ("case"."status" IN ('accessioned','in_process','pending_review','signed_out','amended'));