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

# FEAT-022 Part 1 (ADR-0024): SLA targets per priority, not discipline-scoped.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/sla-targets.sql
echo "Seed applied: sla-targets.sql (placeholder routine/STAT turnaround targets — see its header comment)."

# FEAT-052: third discipline seed (microbiology) -- must run before
# default-report-templates.sql below, same ordering requirement as
# chemistry/haematology. FEAT-051 later extended this same file with a
# real, cited EUCAST breakpoint table (not placeholder) -- see the file's
# own header comments per section.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/microbiology-catalog.sql
echo "Seed applied: microbiology-catalog.sql (culture/organism-ID reflex pair + real EUCAST v16.0 breakpoint catalog)."

# FEAT-032: default, published report_template_version for every seeded
# test_definition (chemistry + haematology, both already applied above) --
# must run after both discipline seeds.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/default-report-templates.sql
echo "Seed applied: default-report-templates.sql (default published report layout per seeded test)."

# FEAT-054: a real, deliberately-authored culture/antibiogram report layout
# for ORGID, superseding the generic default above -- must run after it.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/culture-report-template.sql
echo "Seed applied: culture-report-template.sql (real authored ORGID culture/antibiogram layout)."

# FEAT-058: shared synoptic-report-grid analyte, then the two real
# ICCR-sourced protocols (breast, colorectal) -- common must run first.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/synoptic-protocol-common.sql
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/synoptic-protocol-breast.sql
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/synoptic-protocol-colorectal.sql
echo "Seed applied: synoptic-protocol-{common,breast,colorectal}.sql (real, cited ICCR breast + colorectal synoptic protocols)."

# FEAT-062: real, cited Bethesda System cervical cytology protocol -- no
# ordering dependency on synoptic-protocol-common.sql (that file only seeds
# the shared report-grid analyte breast/colorectal both use; this protocol
# doesn't reference it), grouped here anyway since it's the same mechanism.
docker compose exec -T postgres psql -U postgres -d lis -v ON_ERROR_STOP=1 -f - < db/seed/synoptic-protocol-cytology-pap.sql
echo "Seed applied: synoptic-protocol-cytology-pap.sql (real, cited Bethesda System 2014 cervical cytology protocol)."
