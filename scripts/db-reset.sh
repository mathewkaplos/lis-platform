#!/usr/bin/env bash
set -euo pipefail
echo "Resetting local database..."
docker compose down -v postgres 2>/dev/null || true
docker compose up -d postgres
sleep 3
echo "Postgres is up. Migrations will run here once Drizzle is configured (FEAT-004)."
