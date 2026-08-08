-- TASK-070 (FEAT-020, docs/plans/feat-020-qc-gating-of-result-release.md):
-- adds the resolve lifecycle to qc_rule_violation, per ADR-0019 Decision 3
-- (accepted). drizzle-kit generated output, unmodified except this header --
-- see packages/db/src/schema/qc-rule-violation.ts for the full design
-- rationale. Nullable, additive-only ALTER TABLE; existing TASK-067-era rows
-- default to resolved_at = NULL ("unresolved"), unaffected.
ALTER TABLE "qc_rule_violation" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qc_rule_violation" ADD COLUMN "resolved_by_user_id" uuid;