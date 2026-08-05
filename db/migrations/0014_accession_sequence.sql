-- TASK-045 (FEAT-013 proposal §2/§10 Q1): accession-number generation.
-- Hand-written, not `drizzle-kit generate` output -- a free-standing
-- SEQUENCE has no equivalent in drizzle's schema-builder vocabulary
-- (database-design Skill entry #5's exact precedent). Global, not
-- per-tenant: a single counter is lock-free under concurrent callers
-- regardless of tenant, and per-tenant uniqueness is already the stricter
-- guarantee a global-unique value trivially satisfies, backstopped by
-- specimen's own existing ux_specimen_tenant_accession constraint. Exactly
-- audit_event.sequence's (0010_audit_event.sql) already-shipped precedent
-- and reasoning, reused directly.
CREATE SEQUENCE "accession_number_seq";--> statement-breakpoint

-- Not drizzle-kit generated: 0002_app_role.sql's `ALTER DEFAULT PRIVILEGES
-- IN SCHEMA "public" GRANT ... ON TABLES TO "lis_app"` only ever covered
-- TABLES, never SEQUENCES. 0010_audit_event.sql hit this exact gap for
-- audit_event_sequence_seq (bigserial's own implicit sequence) and
-- documented it with a real reproduced "permission denied for sequence"
-- failure -- applied proactively here rather than rediscovered a second
-- time.
GRANT USAGE, SELECT ON SEQUENCE "accession_number_seq" TO "lis_app";
