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
CHECK_SQL="SELECT
  (SELECT count(*) FROM tenant) AS tenant_count,
  (SELECT count(*) FROM test_definition) AS test_definition_count,
  (SELECT count(*) FROM patient) AS patient_count;"

RESULT=$(docker compose -p "$SCRATCH_PROJECT" -f "$SCRATCH_COMPOSE" exec -T postgres \
  psql -U postgres -d lis -t -A -F',' -c "$CHECK_SQL" < /dev/null 2>>"$LOG_FILE")
if [ $? -ne 0 ] || [ -z "$RESULT" ]; then
  log "FAIL restore-drill: sanity-check query failed"
  exit 1
fi

TENANT_COUNT=$(echo "$RESULT" | cut -d',' -f1)
TEST_DEF_COUNT=$(echo "$RESULT" | cut -d',' -f2)
PATIENT_COUNT=$(echo "$RESULT" | cut -d',' -f3)

if [ "${TENANT_COUNT:-0}" -gt 0 ] && [ "${TEST_DEF_COUNT:-0}" -gt 0 ] && [ "${PATIENT_COUNT:-0}" -gt 0 ]; then
  log "PASS restore-drill: $LATEST_BACKUP restored successfully (tenant=$TENANT_COUNT test_definition=$TEST_DEF_COUNT patient=$PATIENT_COUNT)"
  exit 0
else
  log "FAIL restore-drill: sanity check found an unexpectedly empty table (tenant=$TENANT_COUNT test_definition=$TEST_DEF_COUNT patient=$PATIENT_COUNT)"
  exit 1
fi
