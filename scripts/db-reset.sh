#!/usr/bin/env bash
set -euo pipefail
echo "Resetting local database..."
docker compose down -v postgres 2>/dev/null || true
docker compose up -d postgres

until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  sleep 0.5
done
echo "Postgres is up."

pnpm --filter @lis/db migrate
echo "Migrations applied."

# lis_app is created without a password in the migration itself (never commit
# a secret into a migration file) — set it here the same way POSTGRES_PASSWORD
# is handled: an env var, defaulting to a fixed local-dev value.
docker compose exec -T postgres psql -U postgres -d lis -c \
  "ALTER ROLE lis_app WITH PASSWORD '${LIS_APP_DB_PASSWORD:-lis_app_dev_password}';" >/dev/null
echo "lis_app role password set."

# TASK-066 (ADR-0017): lis_scheduler, same convention as lis_app's password
# above -- never committed into the migration itself.
docker compose exec -T postgres psql -U postgres -d lis -c \
  "ALTER ROLE lis_scheduler WITH PASSWORD '${SCHEDULER_DB_PASSWORD:-lis_scheduler_dev_password}';" >/dev/null
echo "lis_scheduler role password set."

# Seeded as postgres (migrations-only role) so RLS never gets in the way of
# the seed itself; the app connects as lis_app afterward, as it always does.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/chemistry-catalog.sql
echo "Seed applied: chemistry-catalog.sql (placeholder standard panel — see its header comment)."

# TASK-071 (FEAT-023): second discipline seed, same placeholder framing.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/haematology-catalog.sql
echo "Seed applied: haematology-catalog.sql (placeholder CBC + differential panel — see its header comment)."
