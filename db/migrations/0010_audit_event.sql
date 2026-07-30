-- TASK-025: audit_event (KB-11), per the approved FEAT-006 proposal.
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_principal_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"context" jsonb,
	"prev_hash" "bytea",
	"hash" "bytea" NOT NULL,
	CONSTRAINT "ck_audit_event_actor_type" CHECK ("audit_event"."actor_type" IN ('human','service','ai'))
);
--> statement-breakpoint
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "ix_audit_event_tenant_sequence" ON "audit_event" USING btree ("tenant_id","sequence");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_event" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

-- Not drizzle-kit generated: 0002_app_role.sql's `ALTER DEFAULT PRIVILEGES
-- IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO
-- "lis_app"` applies to every table created afterward, including this one --
-- silently, unless explicitly revoked here. KB-11 is explicit that audit
-- rows must be append-only at the grant level ("no UPDATE/DELETE grant
-- exists on the audit table for any application role"), not just by
-- application-code discipline. Without this REVOKE, audit_event would be
-- the fourth instance this session-chain of a table's real privileges
-- silently diverging from what its schema/RLS "looks like" it enforces
-- (same root cause as the postgres/BYPASSRLS, meta/*.json regex, and
-- ENABLE ROW LEVEL SECURITY ordering findings) -- caught here before it
-- became a fourth one, per the FEAT-006 proposal's own flagged risk (§6).
REVOKE UPDATE, DELETE ON "audit_event" FROM "lis_app";--> statement-breakpoint

-- Also not drizzle-kit generated, found by actually running this migration
-- and exercising a real INSERT as lis_app (not assumed): `sequence
-- bigserial` implicitly creates its own SEQUENCE object
-- (audit_event_sequence_seq, Postgres's default <table>_<column>_seq
-- naming), and 0002_app_role.sql's ALTER DEFAULT PRIVILEGES only covers
-- TABLES, never SEQUENCES -- no earlier table in this schema used a
-- serial/bigserial/identity column (every id column uses `uuid DEFAULT
-- gen_random_uuid()`, which needs no sequence), so this gap was never
-- exercised until now. Without this grant, every INSERT as lis_app fails
-- with "permission denied for sequence audit_event_sequence_seq" --
-- confirmed by reproducing the failure before adding this line.
GRANT USAGE, SELECT ON SEQUENCE "audit_event_sequence_seq" TO "lis_app";