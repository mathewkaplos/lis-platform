-- TASK-066 (FEAT-021, docs/plans/feat-021-critical-notification-read-back-escalation.md),
-- ADR-0017 (accepted). Role/grant statements are hand-written (roles have
-- no schema.ts representation at all, same as db/migrations/0002_app_role.sql's
-- own lis_app role creation); the CREATE POLICY statement below them is
-- drizzle-kit generated output, unmodified, from
-- packages/db/src/schema/critical-notification.ts's new schedulerEnumeration()
-- policy -- must run after the role exists, hence this order within one file.
--
-- lis_scheduler is deliberately NOBYPASSRLS -- see 0002_app_role.sql's own
-- comment for why no role in this schema should ever have BYPASSRLS. Its
-- only grant is SELECT on exactly one column (tenant_id) of exactly one
-- table (critical_notification); the policy below further restricts even
-- that to 'pending' rows only. This is the one piece of cross-tenant
-- visibility the escalation job's enumeration phase needs (ADR-0017) --
-- the actual escalation UPDATE/audit write happens separately, as
-- lis_app, fully RLS-scoped, exactly like every other write in this repo.
--
-- Password is NOT set here (never commit a secret into a migration file),
-- same convention as lis_app's own password -- set out-of-band via
-- ALTER ROLE, from SCHEDULER_DB_PASSWORD.
CREATE ROLE "lis_scheduler" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE "lis" TO "lis_scheduler";
GRANT USAGE ON SCHEMA "public" TO "lis_scheduler";
GRANT SELECT (tenant_id) ON "critical_notification" TO "lis_scheduler";
--> statement-breakpoint
CREATE POLICY "scheduler_enumeration" ON "critical_notification" AS PERMISSIVE FOR SELECT TO "lis_scheduler" USING (status = 'pending');
