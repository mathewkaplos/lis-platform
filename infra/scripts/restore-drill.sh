#!/usr/bin/env bash
set -uo pipefail

# FEAT-050 (ADR-0044). Runs on the staging droplet via cron (installed once
# manually -- see infra/scripts/README.md), the same way backup-staging-db.sh
# already is. Restores the most recent backup into a throwaway, ephemeral
# Postgres project (restore-drill-compose.yml) -- NEVER the live `lis`
# project's own postgres container/volume -- runs a real sanity check
# against it, logs the result, and always tears the scratch project down
# regardless of outcome. This is the actual rehearsal AC #1 asks for: the
# *drill itself* runs on a schedule, not just the backup it drills.
#
# Deliberately `set -uo pipefail`, not `set -e`: every step's own exit code
# is checked explicitly so a failure still reaches the always-run teardown
# below, rather than aborting mid-script and leaving the scratch project
# resident (docker-pnpm-monorepo-deploy Skill entry #13's own memory-budget
# concern -- a leaked scratch container is exactly the kind of thing that
# OOMs this box later).

BACKUP_DIR="/mnt/volume_nyc1_1785507357628/backups"
SCRATCH_PROJECT="lis-restore-drill"
SCRATCH_COMPOSE="/opt/lis/scripts/restore-drill-compose.yml"
LOG_FILE="/var/log/lis-restore-drill.log"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG_FILE"
}

teardown() {
  docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" down -v < /dev/null >>"$LOG_FILE" 2>&1
}
trap teardown EXIT

LATEST_BACKUP=$(find "$BACKUP_DIR" -name 'lis-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -z "$LATEST_BACKUP" ]; then
  log "FAIL restore-drill: no backup file found in $BACKUP_DIR"
  exit 1
fi
log "Starting restore drill against $LATEST_BACKUP"

docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" up -d < /dev/null >>"$LOG_FILE" 2>&1
if [ $? -ne 0 ]; then
  log "FAIL restore-drill: could not start scratch Postgres project"
  exit 1
fi

ready=false
for _ in $(seq 1 30); do
  if docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" exec -T postgres pg_isready -U postgres < /dev/null >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [ "$ready" != "true" ]; then
  log "FAIL restore-drill: scratch Postgres did not become ready in time"
  exit 1
fi

# lis_app/lis_scheduler are cluster-level roles created by migrations
# (db/migrations/0002_app_role.sql, 0018_lis_scheduler_role.sql) -- a plain
# `pg_dump` of just the `lis` database never captures CREATE ROLE statements
# (roles are cluster-wide, not per-database), so a handful of this dump's
# own `CREATE POLICY ... TO lis_scheduler` statements fail against a bare
# scratch container with only the `postgres` superuser. Real finding, caught
# by actually running this drill against a real backup (2026-08-11) -- not
# guessed. No login/password/grants needed here (this scratch instance is
# never connected to as either role, --no-owner/--no-privileges above
# already strips the GRANT statements this dump also contains) -- the roles
# only need to exist so CREATE POLICY's own role reference resolves.
docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" exec -T postgres \
  psql -U postgres -d lis -v ON_ERROR_STOP=0 -c \
  'CREATE ROLE "lis_app"; CREATE ROLE "lis_scheduler";' < /dev/null >>"$LOG_FILE" 2>&1

if ! docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" exec -T postgres \
    pg_restore -U postgres -d lis --no-owner --no-privileges < "$LATEST_BACKUP" >>"$LOG_FILE" 2>&1; then
  log "FAIL restore-drill: pg_restore reported an error for $LATEST_BACKUP"
  exit 1
fi

# Sanity check: a small, fixed set of tables that should never be empty in a
# real backup. Nonzero on all three = pass; zero or a query error = fail.
# This is deliberately not "does pg_restore exit 0" alone -- pg_restore can
# exit 0 while having skipped/errored on individual objects it treats as
# non-fatal; a real row-count proves data actually landed.
#
# `test_definition`/`analyte`/`code_system_value` -- not `tenant`/`patient` --
# confirmed live against the real staging database before picking these
# (2026-08-11): this is a pre-launch environment with zero onboarded tenants
# and zero patients yet (both real, expected zeros, not a restore bug), while
# the seeded chemistry/haematology catalogs guarantee these three tables are
# always populated. Checking tenant/patient here would make this drill fail
# every single run regardless of whether the restore actually worked.
CHECK_SQL="SELECT
  (SELECT count(*) FROM test_definition) AS test_definition_count,
  (SELECT count(*) FROM analyte) AS analyte_count,
  (SELECT count(*) FROM code_system_value) AS code_system_value_count;"

RESULT=$(docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" exec -T postgres \
  psql -U postgres -d lis -t -A -F',' -c "$CHECK_SQL" < /dev/null 2>>"$LOG_FILE")
if [ $? -ne 0 ] || [ -z "$RESULT" ]; then
  log "FAIL restore-drill: sanity-check query failed"
  exit 1
fi

TEST_DEF_COUNT=$(echo "$RESULT" | cut -d',' -f1)
ANALYTE_COUNT=$(echo "$RESULT" | cut -d',' -f2)
CODE_SYSTEM_VALUE_COUNT=$(echo "$RESULT" | cut -d',' -f3)

if [ "${TEST_DEF_COUNT:-0}" -gt 0 ] && [ "${ANALYTE_COUNT:-0}" -gt 0 ] && [ "${CODE_SYSTEM_VALUE_COUNT:-0}" -gt 0 ]; then
  log "PASS restore-drill: $LATEST_BACKUP restored successfully (test_definition=$TEST_DEF_COUNT analyte=$ANALYTE_COUNT code_system_value=$CODE_SYSTEM_VALUE_COUNT)"
  exit 0
else
  log "FAIL restore-drill: sanity check found an unexpectedly empty table (test_definition=$TEST_DEF_COUNT analyte=$ANALYTE_COUNT code_system_value=$CODE_SYSTEM_VALUE_COUNT)"
  exit 1
fi
