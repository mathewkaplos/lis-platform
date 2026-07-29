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

echo "NOT YET IMPLEMENTED: seed. Tracked in FEAT-004 / TASK-019 / #13 (M1) — see docs/plans/feat-004-catalog-metadata-model.md."
