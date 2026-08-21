-- Issue #715 (EPIC #697): invoice-number generation. Hand-written, not
-- `drizzle-kit generate` output -- a free-standing SEQUENCE has no
-- equivalent in drizzle's schema-builder vocabulary (database-design Skill
-- entry #5's precedent). Global, not per-tenant -- same reasoning
-- 0014_accession_sequence.sql's own header comment already gives for
-- accession_number_seq: a single lock-free counter satisfies per-tenant
-- uniqueness (ux_invoice_tenant_invoice_number) trivially.
CREATE SEQUENCE "invoice_number_seq";--> statement-breakpoint

-- Same gap 0014_accession_sequence.sql's own header comment documents:
-- 0002_app_role.sql's default-privileges grant only ever covered TABLES,
-- never SEQUENCES.
GRANT USAGE, SELECT ON SEQUENCE "invoice_number_seq" TO "lis_app";
