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
