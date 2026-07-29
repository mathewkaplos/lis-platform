#!/usr/bin/env bash
set -euo pipefail
echo "Resetting local database..."
docker compose down -v postgres 2>/dev/null || true
docker compose up -d postgres
sleep 3
echo "Postgres is up."
echo "NOT YET IMPLEMENTED: migrate + seed. Tracked in FEAT-004 / #13 (M1) — see docs/plans/feat-001-monorepo-toolchain.md."
