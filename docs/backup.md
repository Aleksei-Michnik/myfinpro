# MyFinPro Backup Strategy

## Overview

MyFinPro uses automated MySQL database backups with verification, retention policies, and age-based alerting. Backups are created as compressed SQL dumps (`mysqldump | gzip`) and stored locally with configurable retention.

**Key parameters:**

| Parameter        | Default       | Description                       |
| ---------------- | ------------- | --------------------------------- |
| Daily retention  | 7             | Number of daily backups to keep   |
| Weekly retention | 4             | Number of weekly backups to keep  |
| Max backup age   | 26 hours      | Alert threshold for stale backups |
| Schedule         | 2:00 AM daily | Cron-based backup schedule        |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Cron Job    │────▶│  backup.sh   │────▶│  MySQL (Docker)  │
│  (daily 2AM) │     │              │     │  mysqldump       │
└──────────────┘     └──────┬───────┘     └──────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  /var/backups│
                     │  /myfinpro/  │
                     │  *.sql.gz    │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────┐ ┌─────────────┐
     │ verify-      │ │ check-   │ │ CI workflow │
     │ backup.sh    │ │ backup-  │ │ (weekly)    │
     │              │ │ age.sh   │ │             │
     └──────────────┘ └──────────┘ └─────────────┘
```

## Setup

### 1. Configure Environment

```bash
cp infrastructure/backup/backup.env.example infrastructure/backup/backup.env
# Edit backup.env with your MySQL credentials and paths
```

### 2. Create Backup Directory

```bash
sudo mkdir -p /var/backups/myfinpro
sudo chown $(whoami):$(whoami) /var/backups/myfinpro
```

### 3. Create Log Directory

```bash
sudo mkdir -p /var/log/myfinpro
sudo chown $(whoami):$(whoami) /var/log/myfinpro
```

### 4. Install Cron Jobs

```bash
crontab infrastructure/backup/crontab
```

Or append to your existing crontab:

```bash
crontab -l | cat - infrastructure/backup/crontab | crontab -
```

### 5. Make Scripts Executable

```bash
chmod +x scripts/backup.sh scripts/restore.sh scripts/verify-backup.sh scripts/check-backup-age.sh
```

## Manual Backup

### Using Docker (production)

```bash
./scripts/backup.sh --docker
```

### Using Direct MySQL Connection

```bash
./scripts/backup.sh --host localhost --port 3306 --user myfinpro --database myfinpro
```

### Custom Output Directory

```bash
./scripts/backup.sh --docker --output-dir /path/to/backups
```

## Restore from Backup

### Interactive Restore (with confirmation prompt)

```bash
./scripts/restore.sh /var/backups/myfinpro/myfinpro_2025-01-15_02-00-00.sql.gz --docker
```

### Automated Restore (skip confirmation)

```bash
./scripts/restore.sh /var/backups/myfinpro/myfinpro_2025-01-15_02-00-00.sql.gz --docker --force
```

### Restore to Different Database

```bash
./scripts/restore.sh backup.sql.gz --host localhost --database myfinpro_staging
```

## Backup Verification

### Basic Verification

Checks that a recent backup exists, is non-empty, and has valid gzip format:

```bash
./scripts/verify-backup.sh --backup-dir /var/backups/myfinpro --max-age-hours 26
```

### Verification with Test Restore

Performs a full test restore to a temporary database and verifies tables exist:

```bash
./scripts/verify-backup.sh --test-restore --docker
```

### JSON Output

The verify script outputs JSON status for monitoring integration:

```json
{
  "status": "ok",
  "message": "Backup is valid and recent",
  "timestamp": "2025-01-15T03:00:00Z",
  "backup_file": "myfinpro_2025-01-15_02-00-00.sql.gz",
  "backup_age_hours": 1,
  "backup_size_bytes": 15234567,
  "max_age_hours": 26,
  "test_restore": true,
  "table_count": 12,
  "backup_dir": "/var/backups/myfinpro"
}
```

## Monitoring & Alerting

### Backup Age Check

The `check-backup-age.sh` script is designed to be run periodically (every 6 hours by default) to ensure backups remain fresh:

```bash
./scripts/check-backup-age.sh --max-age 26
```

**Exit codes:**

- `0` — Backup is within the acceptable age threshold
- `1` — Backup is too old or missing

### Webhook Alerts

Send alerts to a monitoring system via webhook:

```bash
./scripts/check-backup-age.sh --max-age 26 --alert-webhook https://hooks.slack.com/services/...
```

The webhook receives a JSON payload:

```json
{
  "text": "ALERT: Backup 'myfinpro_2025-01-14_02-00-00.sql.gz' is 28h old (threshold: 26h)",
  "status": "warning",
  "service": "myfinpro-backup",
  "timestamp": "2025-01-15T06:00:00Z",
  "hostname": "prod-server-01"
}
```

### CI Verification

A GitHub Actions workflow (`.github/workflows/backup-verify.yml`) runs weekly to:

1. Spin up a MySQL 8.4 container
2. Create sample data
3. Run the backup script
4. Verify the backup file integrity
5. Restore to a fresh database
6. Verify restored data matches original
7. Test the backup age check script

## Disaster Recovery Procedure

### Step 1: Identify the Backup to Restore

```bash
ls -lt /var/backups/myfinpro/
```

### Step 2: Verify Backup Integrity

```bash
gzip -t /var/backups/myfinpro/myfinpro_YYYY-MM-DD_HH-MM-SS.sql.gz
echo $?  # Should be 0
```

### Step 3: Stop Application Services

```bash
docker compose -f docker-compose.production.yml stop api bot web
```

### Step 4: Restore the Database

```bash
./scripts/restore.sh /var/backups/myfinpro/myfinpro_YYYY-MM-DD_HH-MM-SS.sql.gz --docker --force
```

### Step 5: Verify the Restore

```bash
docker exec myfinpro-mysql-1 mysql -u myfinpro -p myfinpro -e "SHOW TABLES;"
```

### Step 6: Restart Application Services

```bash
docker compose -f docker-compose.production.yml up -d api bot web
```

### Step 7: Verify Application Health

```bash
curl -s http://localhost:3000/api/health | jq .
```

## Retention Policy

Backups follow a tiered retention policy:

| Tier   | Retention | Description                                      |
| ------ | --------- | ------------------------------------------------ |
| Daily  | 7 backups | The 7 most recent backups are always kept        |
| Weekly | 4 backups | One backup per week is kept for the last 4 weeks |

The cleanup runs automatically after each backup. Backups that don't fall within either retention tier are deleted.

**Example timeline:**

```
Day 1-7:   All daily backups kept (7 files)
Week 2-5:  One backup per week kept (4 files)
Older:     Automatically deleted
```

## Configuration Reference

All configuration is done via environment variables. See [`backup.env.example`](../infrastructure/backup/backup.env.example) for the full template.

| Variable                  | Default                 | Description              |
| ------------------------- | ----------------------- | ------------------------ |
| `BACKUP_DIR`              | `/var/backups/myfinpro` | Backup storage directory |
| `BACKUP_RETENTION_DAILY`  | `7`                     | Daily backups to retain  |
| `BACKUP_RETENTION_WEEKLY` | `4`                     | Weekly backups to retain |
| `BACKUP_MAX_AGE_HOURS`    | `26`                    | Alert threshold in hours |
| `MYSQL_HOST`              | `localhost`             | MySQL host               |
| `MYSQL_PORT`              | `3306`                  | MySQL port               |
| `MYSQL_USER`              | `myfinpro`              | MySQL user               |
| `MYSQL_PASSWORD`          | —                       | MySQL password           |
| `MYSQL_DATABASE`          | `myfinpro`              | MySQL database name      |
| `DOCKER_CONTAINER_NAME`   | `myfinpro-mysql-1`      | Docker container name    |
| `ALERT_WEBHOOK_URL`       | —                       | Webhook URL for alerts   |

## Script Reference

| Script                                                          | Purpose                               |
| --------------------------------------------------------------- | ------------------------------------- |
| [`scripts/backup.sh`](../scripts/backup.sh)                     | Create compressed database backup     |
| [`scripts/restore.sh`](../scripts/restore.sh)                   | Restore database from backup          |
| [`scripts/verify-backup.sh`](../scripts/verify-backup.sh)       | Verify backup existence and integrity |
| [`scripts/check-backup-age.sh`](../scripts/check-backup-age.sh) | Check backup age and alert            |
