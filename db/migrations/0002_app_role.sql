-- The API must never connect as a superuser/BYPASSRLS role, or every RLS
-- policy created so far (and every one still to come) is a no-op: Postgres
-- exempts superusers and the table owner from RLS regardless of policy
-- content. Migrations still run as `postgres` (the owner); the application
-- connects as `lis_app` instead, so RLS actually applies to it.
--
-- Password is NOT set here (never commit a secret into a migration file) --
-- it is set out-of-band via ALTER ROLE, from LIS_APP_DB_PASSWORD, the same
-- way POSTGRES_PASSWORD is handled outside of migrations.
CREATE ROLE "lis_app" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE "lis" TO "lis_app";
GRANT USAGE ON SCHEMA "public" TO "lis_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "lis_app";
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "lis_app";
