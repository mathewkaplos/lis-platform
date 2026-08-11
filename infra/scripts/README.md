# Staging droplet scripts

Scripts deployed to `/opt/lis/scripts` on the staging droplet by
`deploy-staging.yml` on every deploy, so the droplet always has the latest
version. Anything here runs on the droplet itself, not in CI.

## backup-staging-db.sh

Daily `pg_dump` of the staging Postgres database to the attached Block
Storage Volume (`/mnt/volume_nyc1_1785507357628/backups`), custom format
(`-Fc`), 7-day retention.

**One-time setup on the droplet** (not run by the deploy workflow --
installing a cron job isn't something that needs to happen on every deploy,
only once; re-running is safe and idempotent, it replaces rather than
duplicates the entry):

```bash
(crontab -l 2>/dev/null | grep -v backup-staging-db.sh; \
  echo "0 3 * * * /opt/lis/scripts/backup-staging-db.sh >> /var/log/lis-db-backup.log 2>&1") \
  | crontab -
```

Runs daily at 03:00 UTC. Check it ran: `cat /var/log/lis-db-backup.log` or
`ls -lh /mnt/volume_nyc1_1785507357628/backups`.

To restore a backup:
```bash
docker compose exec -T postgres pg_restore -U postgres -d lis --clean \
  < /mnt/volume_nyc1_1785507357628/backups/lis-<timestamp>.dump
```

## restore-drill.sh

FEAT-050 (ADR-0044). The actual rehearsal AC #1 asks for -- restores the most
recent backup into a **throwaway, ephemeral Postgres project**
(`restore-drill-compose.yml`, project name `lis-restore-drill`), completely
separate from the real `lis` project's own postgres container/volume. Never
touches live data. Runs a row-count sanity check on 3 fixed tables
(`test_definition`/`analyte`/`code_system_value` -- confirmed live against the
real staging database that `tenant`/`patient` are legitimately zero on this
pre-launch environment, so checking those would fail every run regardless of
whether the restore worked), logs pass/fail to
`/var/log/lis-restore-drill.log`, and always tears the scratch project down
afterward regardless of outcome.

**One-time setup on the droplet** (same idempotent-replace pattern as
`backup-staging-db.sh`'s own entry above; offset to 03:30 UTC so it always
drills the backup that just completed at 03:00):

```bash
(crontab -l 2>/dev/null | grep -v restore-drill.sh; \
  echo "30 3 * * * /opt/lis/scripts/restore-drill.sh") \
  | crontab -
```

Check it ran: `cat /var/log/lis-restore-drill.log`. A `PASS` line includes
the row counts found; a `FAIL` line states which step failed.
