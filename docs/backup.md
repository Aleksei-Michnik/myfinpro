# MyFinPro Backup Strategy

## Overview

The production and staging databases are dumped daily by a scheduled GitHub Actions workflow,
[`backup.yml`](../.github/workflows/backup.yml). The dump runs **inside the environment's MySQL
container with the container's own credentials**: no credentials file exists on the server, no
password appears on a host command line, and the workflow itself holds only the SSH host, user and
key secrets. Backups are compressed SQL dumps (`mysqldump | gzip`) kept on the server under
`/opt/myfinpro/backups/<environment>/`.

**Key parameters:**

| Parameter        | Value                                | Description                                          |
| ---------------- | ------------------------------------ | ---------------------------------------------------- |
| Schedule         | daily, 02:17 UTC                     | `backup.yml` cron; also runnable by dispatch         |
| Environments     | production, staging                  | one job each, run one after the other                |
| Daily retention  | 7                                    | newest daily backups kept                            |
| Weekly retention | 4                                    | first backup of each of the last 4 ISO weeks kept    |
| Max backup age   | 26 hours                             | the run fails when the newest backup is older        |
| Restore drill    | Sundays, or `drill=true` on dispatch | newest backup restored into `<db>_verify`, then drop |
| Pre-deploy dump  | every production deploy              | `pre-deploy-<stamp>.sql.gz`, five kept               |

## Architecture

```
┌────────────────────┐  ssh   ┌───────────────────────────────┐
│ backup.yml         │───────▶│ /opt/myfinpro/backups/scripts │
│ schedule/dispatch  │  scp   │  backup.sh <env>              │
└────────────────────┘        │  verify-backup.sh <env>       │
                              │  check-backup-age.sh <env>    │
                              └──────────────┬────────────────┘
                                             │ docker exec <env mysql container>
                                             │ sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" … "$MYSQL_DATABASE"'
                                             ▼
                              ┌───────────────────────────────┐
                              │ /opt/myfinpro/backups/<env>/  │
                              │  myfinpro_<date>_<time>.sql.gz│  ← scheduled (retention 7 + 4)
                              │  pre-deploy-<stamp>.sql.gz    │  ← deploy-production.yml (5 kept)
                              └───────────────────────────────┘
```

Every scheduled run, per environment:

1. `scripts/backup.sh <env>` — dump inside the container, `gunzip -t` the new file, apply retention.
2. `scripts/verify-backup.sh <env>` — newest file exists, is non-empty, passes `gunzip -t`, is
   younger than 26 h. On Sundays or with the `drill` input: `--test-restore` restores it into
   `<database>_verify`, counts tables and rows, drops the schema.
3. `scripts/check-backup-age.sh <env> --max-age 26` — exits 1 when the newest backup is older
   than 26 hours, which fails the run. **A failed scheduled run is the alert**: GitHub e-mails the
   repository owner about failed scheduled workflows; check **Actions → Backup**.

The scripts are copied to `/opt/myfinpro/backups/scripts/` by the workflow on every run, so the
server always executes the version on the branch the run was started from.

## Running a backup by hand

From the repository, with the GitHub CLI:

```bash
gh workflow run backup.yml                 # both environments
gh workflow run backup.yml -f drill=true   # …plus the restore drill
gh run watch $(gh run list --workflow=backup.yml --limit=1 --json databaseId --jq '.[0].databaseId')
```

On the server (after at least one workflow run has placed the scripts):

```bash
cd /opt/myfinpro/backups/scripts
./backup.sh production                      # or staging
./verify-backup.sh production --test-restore
./check-backup-age.sh production --max-age 26
```

Any other MySQL container whose environment carries `MYSQL_ROOT_PASSWORD` and `MYSQL_DATABASE`
(the local `docker-compose.yml` one, for instance) works with `--container NAME --output-dir DIR`.

## Pre-deploy dump

[`deploy-production.yml`](../.github/workflows/deploy-production.yml) dumps the production
database before it copies anything to the server (step "Back up the production database"), into
`/opt/myfinpro/backups/production/pre-deploy-<UTC stamp>.sql.gz`, and keeps the five newest. A
blue/green rollback switches traffic back to the previous slot but does **not** roll the database
back: when a release changed the schema, restore this dump first, then `scripts/rollback.sh`. The
step skips cleanly when the container does not exist yet (first deploy).

## Restore from Backup

`scripts/restore.sh` takes the same targets as the other scripts. It verifies the file
(`.sql.gz`, non-empty, `gunzip -t`) and asks for confirmation unless `--force` is given.

```bash
cd /opt/myfinpro/backups/scripts

# Into the environment's own database, inside its container
./restore.sh ../production/myfinpro_2026-09-25_02-17-03.sql.gz production

# Unattended
./restore.sh ../production/pre-deploy-20260925-101500.sql.gz production --force

# Into another database in the same container (a copy to inspect, say)
./restore.sh ../production/myfinpro_2026-09-25_02-17-03.sql.gz production --database myfinpro_copy

# Over a direct connection (CI, a local MySQL); password from MYSQL_PASSWORD, passed as MYSQL_PWD
MYSQL_PASSWORD=… ./restore.sh backup.sql.gz --host 127.0.0.1 --user root --database myfinpro
```

## Backup Verification

```bash
# Existence, size, gzip integrity, age
./verify-backup.sh production --max-age-hours 26

# …plus the restore drill (into <db>_verify, dropped afterwards)
./verify-backup.sh production --test-restore
```

The verify script prints JSON on stdout (logs go to stderr):

```json
{
  "status": "ok",
  "message": "Backup is valid and recent",
  "timestamp": "2026-09-25T02:18:10Z",
  "backup_file": "myfinpro_2026-09-25_02-17-03.sql.gz",
  "backup_age_hours": 0,
  "backup_size_bytes": 427127,
  "max_age_hours": 26,
  "test_restore": true,
  "table_count": 31,
  "row_count": 4812,
  "backup_dir": "/opt/myfinpro/backups/production"
}
```

## Monitoring & Alerting

### Backup age check

`check-backup-age.sh` compares the newest scheduled backup's age (in seconds) with the threshold:

```bash
./check-backup-age.sh production --max-age 26
```

**Exit codes:** `0` within the threshold, `1` too old or missing. Pre-deploy dumps are not
counted: only `myfinpro_*.sql.gz` files satisfy the check, so a stalled schedule is noticed even
while deploys keep producing dumps.

### Where the alert lands

The workflow runs the age check last, so a missing or stale backup fails the run. GitHub notifies
the repository owner of failed scheduled workflow runs (Settings → Notifications → Actions). An
optional webhook is still supported: `--alert-webhook URL` (or `ALERT_WEBHOOK_URL`) posts

```json
{
  "text": "ALERT: Backup 'myfinpro_2026-09-24_02-17-03.sql.gz' is 28h old (threshold: 26h)",
  "status": "warning",
  "service": "myfinpro-backup",
  "timestamp": "2026-09-25T06:00:00Z",
  "hostname": "…"
}
```

### CI drill

[`backup-verify.yml`](../.github/workflows/backup-verify.yml) runs weekly (Sunday 03:00 UTC) and
on dispatch against a throwaway `mysql:9.7` service in CI, not against the server. It creates
sample tables, runs `backup.sh`, verifies the file, runs `verify-backup.sh --test-restore`,
restores with `restore.sh`, compares row counts, and checks both outcomes of
`check-backup-age.sh`. It proves the scripts; `backup.yml` proves the server.

## Disaster Recovery Procedure

All commands run on the server as the deploy user.

### Step 1: Identify the backup to restore

```bash
ls -lt /opt/myfinpro/backups/production/
```

### Step 2: Verify its integrity

```bash
gunzip -t /opt/myfinpro/backups/production/<file>.sql.gz && echo ok
```

### Step 3: Stop the application slot

Find the active slot, then stop its api and web containers (the infra stack with MySQL stays up):

```bash
cat /opt/myfinpro/production/.active-slot
docker stop myfinpro-prod-api-<slot> myfinpro-prod-web-<slot>
```

### Step 4: Restore the database

```bash
cd /opt/myfinpro/backups/scripts
./restore.sh /opt/myfinpro/backups/production/<file>.sql.gz production
```

### Step 5: Verify the restore

```bash
docker exec myfinpro-prod-mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;"'
```

### Step 6: Start the application slot

```bash
docker start myfinpro-prod-api-<slot> myfinpro-prod-web-<slot>
```

If the restore accompanies a rollback across a schema change, run `scripts/rollback.sh production`
from `/opt/myfinpro/production` instead (it starts the previous slot itself).

### Step 7: Verify application health

```bash
curl -sf https://<production domain>/api/v1/health | jq .
```

## Retention Policy

| Tier       | Retention | Description                                               |
| ---------- | --------- | --------------------------------------------------------- |
| Daily      | 7 files   | the 7 newest scheduled backups                            |
| Weekly     | 4 files   | the first backup of each of the last 4 ISO weeks          |
| Pre-deploy | 5 files   | newest pre-deploy dumps, swept by `deploy-production.yml` |

`backup.sh` applies the daily/weekly sweep after every successful dump; a file that fits neither
tier is deleted. Pre-deploy dumps are named differently and never touched by that sweep.

## Off-box copies — the owner's decision

Everything above lives on the same disk as the database. A host loss loses the backups too. The
dumps contain **personal financial data** (transactions, receipts, e-mail addresses), so any copy
off the server needs the same care as the database itself: encryption at rest, a destination the
owner controls, and a documented deletion path. Options, none implemented:

| Option                                           | Notes                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Object storage (S3-compatible, Backblaze B2, R2) | cheapest and simplest; encrypt before upload (`age`, `gpg`) or use a bucket with SSE; needs a write-only credential as a GitHub secret                 |
| The workflow uploads the dump as a run artifact  | no new infrastructure, but the artifact is stored by GitHub (public repository, private artifacts still leave the owner's control); 90-day default TTL |
| `rsync`/`scp` to a second machine the owner runs | full control; needs a reachable host and a key, and the same retention logic there                                                                     |
| Provider-level snapshots of the server disk      | one click at the hosting provider; whole-disk, not per-database; restore granularity is the whole server                                               |

## Configuration Reference

Everything is a script argument or an environment variable; there is no configuration file.

| Variable                                                   | Default                 | Description                                                      |
| ---------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `BACKUP_ROOT`                                              | `/opt/myfinpro/backups` | parent of the per-environment directories                        |
| `BACKUP_DIR`                                               | `$BACKUP_ROOT/<env>`    | overrides the directory (`--output-dir` / `--backup-dir`)        |
| `BACKUP_RETENTION_DAILY`                                   | `7`                     | daily backups to retain                                          |
| `BACKUP_RETENTION_WEEKLY`                                  | `4`                     | weekly backups to retain                                         |
| `BACKUP_MAX_AGE_HOURS`                                     | `26`                    | age threshold                                                    |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_DATABASE` | —                       | direct-connection mode only                                      |
| `MYSQL_PASSWORD`                                           | —                       | direct-connection mode only; handed to the client as `MYSQL_PWD` |
| `ALERT_WEBHOOK_URL`                                        | —                       | optional webhook for `check-backup-age.sh`                       |

## Script Reference

| Script                                                          | Purpose                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| [`scripts/backup-common.sh`](../scripts/backup-common.sh)       | shared helpers: environment → container/directory, clients |
| [`scripts/backup.sh`](../scripts/backup.sh)                     | dump, gzip-test, retention                                 |
| [`scripts/verify-backup.sh`](../scripts/verify-backup.sh)       | existence, age, integrity, restore drill                   |
| [`scripts/check-backup-age.sh`](../scripts/check-backup-age.sh) | age gate (the alert)                                       |
| [`scripts/restore.sh`](../scripts/restore.sh)                   | restore a dump into a database                             |
