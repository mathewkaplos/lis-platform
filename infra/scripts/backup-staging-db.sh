#!/usr/bin/env bash
set -euo pipefail

# Runs on the staging droplet via cron (installed once manually -- see
# infra/scripts/README.md). Deployed to /opt/lis/scripts by deploy-staging.yml
# on every deploy, so it always matches this file.
#
# Writes to the attached 20GB Block Storage Volume, not the 24GB root disk --
# that volume otherwise sits unused (see the root-disk-full incident: the
# real fix there was pruning unreferenced images, not this volume, but it's a
# safe place for backups without touching Docker's storage config at all).

BACKUP_DIR="/mnt/volume_nyc1_1785507357628/backups"
RETENTION_DAYS=7
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/lis-$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

cd /opt/lis
docker compose exec -T postgres pg_dump -U postgres -d lis -Fc > "$BACKUP_FILE"

# Custom format (-Fc), not plain SQL: supports pg_restore --jobs for faster
# parallel restore and selective table/schema restore, at no extra cost here.
# Restore with: docker compose exec -T postgres pg_restore -U postgres -d lis --clean < "$BACKUP_FILE"

find "$BACKUP_DIR" -name 'lis-*.dump' -mtime "+$RETENTION_DAYS" -delete

echo "Backup complete: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
