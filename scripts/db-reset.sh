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

echo "NOT YET IMPLEMENTED: seed. Tracked in FEAT-004 / TASK-019 / #13 (M1) — see docs/plans/feat-004-catalog-metadata-model.md."
